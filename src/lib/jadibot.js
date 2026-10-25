import { Telegraf } from "telegraf";
import { telegrafOptions } from "./net.js";
import chalk from "chalk";
import config from "../../config.js";
import { jadibotDb } from "../database.js";
import { isOwner, isPartner, isPremium, allOwnerIds } from "../middleware.js";
import { registerCallback } from "./callbacks.js";
import { sendView, editView, editCbView, replyView, dropAnim, note, title, table, quote, para } from "./richUi.js";

// ===== Jadi Bot =====
// User Premium ke atas mengirim token BotFather miliknya -> bot ini menjalankan SALINAN dirinya
// (semua plugin & handler yang sama) memakai token itu, di proses yang sama.
// Catatan: bot clone memakai database yang sama dengan bot utama (user, koin, grup).
// Hak owner bot (perintah ownerOnly) TIDAK diberikan ke pemilik clone.

const TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const PENDING_TTL = 5 * 60 * 1000;
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cfg = () => ({ enabled: true, maxPerUser: 1, maxTotal: 20, ...(config.jadibot || {}) });

let mainBot = null;
let mainMe = null;
let registrar = null;
const running = new Map(); // ownerId -> { bot, botId, username }
const pending = new Map(); // userId -> expires

export function setMainBot(bot, me) { mainBot = bot; mainMe = me; }
export function setHandlerRegistrar(fn) { registrar = fn; }
/** Telegram bot utama: dipakai untuk cek wajib join walau perintah datang lewat bot clone */
export const getMainTelegram = () => mainBot?.telegram || null;

/** Premium, Partner, atau Owner */
export const canJadibot = (uid) => isOwner(uid) || isPartner(uid) || isPremium(uid);
export const isCloneCtx = (ctx) => Boolean(ctx.state?.isClone);
export const getClone = (uid) => running.get(String(uid)) || null;
export const listClones = () => [...running.entries()].map(([owner, c]) => ({ owner, botId: c.botId, username: c.username }));

async function notify(telegram, userId, rich) {
  await sendView(telegram, userId, rich).catch(() => {});
}

async function removeRecord(ownerId) {
  delete jadibotDb.data.bots[String(ownerId)];
  await jadibotDb.write();
}

/** Jalankan satu bot clone. Melempar Error dengan pesan siap tampil bila gagal. */
export async function startClone(ownerId, token, { restore = false } = {}) {
  ownerId = String(ownerId);
  if (!registrar) throw new Error("Bot belum siap, coba lagi sebentar lagi.");
  if (token === config.botToken) throw new Error("Itu token bot utama, bukan bot milikmu. Buat bot baru di @BotFather.");
  if (running.has(ownerId)) throw new Error("Kamu sudah punya bot clone yang berjalan. Hentikan dulu dengan /stopjadibot.");
  if (!restore) {
    if (running.size >= cfg().maxTotal) throw new Error("Slot bot clone sedang penuh. Coba lagi nanti.");
    if (!canJadibot(ownerId)) throw new Error("Fitur ini khusus Premium ke atas.");
  }

  const bot = new Telegraf(token, await telegrafOptions());
  let me;
  try {
    me = await bot.telegram.getMe();
  } catch {
    throw new Error("Token tidak valid atau sudah dicabut. Periksa lagi token dari @BotFather.");
  }
  if (me.id === mainMe?.id) throw new Error("Itu token bot utama, bukan bot milikmu.");
  for (const c of running.values()) if (c.botId === me.id) throw new Error("Token itu sudah dipakai oleh clone lain.");

  bot.use((ctx, next) => { ctx.state.isClone = true; return next(); });
  registrar(bot, { isClone: true, ownerId });
  bot.catch((err, ctx) => console.error(chalk.red(`[JADIBOT @${me.username}] ${ctx.updateType}:`), err?.message || err));

  const launching = bot.launch({
    allowedUpdates: ["message", "edited_message", "channel_post", "callback_query", "my_chat_member", "chat_member", "message_reaction", "chat_join_request"],
  });
  // launch() baru selesai saat bot berhenti; kegagalan awal (mis. token dipakai instance lain) tertangkap lewat race
  let failed = null;
  launching.catch((err) => { failed = err; });
  await new Promise((r) => setTimeout(r, 1500));
  if (failed) throw new Error(`Gagal menjalankan bot: ${failed.description || failed.message}`);

  running.set(ownerId, { bot, botId: me.id, username: me.username });
  launching.catch(async (err) => {
    // bot berhenti sendiri (token dicabut / konflik) -> bersihkan & beri tahu pemilik
    if (running.get(ownerId)?.bot !== bot) return;
    running.delete(ownerId);
    await removeRecord(ownerId).catch(() => {});
    console.warn(chalk.yellow(`[JADIBOT] @${me.username} berhenti: ${err?.message}`));
    notify(mainBot.telegram, ownerId, note("⚠️", `Bot clone @${esc(me.username)} berhenti`, `${esc(err?.description || err?.message)}<br>Kirim token lagi lewat tombol <tg-emoji emoji-id="5287684458881756303">🤖</tg-emoji> Jadi Bot jika ingin menjalankannya kembali.`));
  });

  jadibotDb.data.bots[ownerId] = { token, botId: me.id, username: me.username, createdAt: jadibotDb.data.bots[ownerId]?.createdAt || Date.now() };
  await jadibotDb.write();
  console.log(chalk.green(`[JADIBOT] @${me.username} aktif (owner ${ownerId})`));
  return me;
}

export async function stopClone(ownerId, sig = "jadibot") {
  ownerId = String(ownerId);
  const c = running.get(ownerId);
  running.delete(ownerId);
  if (c) { try { c.bot.stop(sig); } catch {} }
  await removeRecord(ownerId).catch(() => {});
  return c;
}

/** Saat bot utama dimatikan: hentikan semua clone tanpa menghapus data (dijalankan ulang saat start) */
export function stopAllClones(sig = "SIGINT") {
  for (const c of running.values()) { try { c.bot.stop(sig); } catch {} }
  running.clear();
}

/** Jalankan ulang clone tersimpan. Pemilik yang sudah bukan premium lagi dilewati (data dipertahankan). */
export async function restoreClones() {
  if (cfg().enabled === false) return;
  for (const [owner, rec] of Object.entries(jadibotDb.data.bots || {})) {
    if (!canJadibot(owner)) { console.log(chalk.yellow(`[JADIBOT] Lewati clone ${owner}: bukan premium lagi.`)); continue; }
    try {
      await startClone(owner, rec.token, { restore: true });
    } catch (err) {
      console.warn(chalk.yellow(`[JADIBOT] Gagal pulihkan clone ${owner}: ${err.message}`));
      if (/tidak valid|dicabut/i.test(err.message)) await removeRecord(owner).catch(() => {});
    }
  }
}

// ===== Antarmuka (rich message + tombol berwarna) =====
const back = (uid) => [
  { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "5352759161945867747", emoji_fallback: "🔙", callback_data: `menu:s:${uid}` },
  { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` },
];

async function editOrSend(ctx, rich, rows) {
  const msg = ctx.callbackQuery?.message;
  if (msg && !(msg.photo && !msg.rich_message)) return editCbView(ctx, rich, rows);
  if (msg) { dropAnim(ctx); await ctx.deleteMessage().catch(() => {}); }
  return sendView(ctx.telegram, ctx.chat.id, rich, rows);
}

/** Tampilan menu Jadi Bot (dari tombol di menu, atau /jadibot tanpa token) */
export async function showJadibotMenu(ctx) {
  const viaButton = Boolean(ctx.callbackQuery);
  const deny = (t) => (viaButton ? ctx.answerCbQuery(t, { show_alert: true }) : replyView(ctx, note("⚠️", "Jadi Bot", esc(t))));
  if (cfg().enabled === false) return deny("Fitur Jadi Bot sedang dinonaktifkan.");
  if (isCloneCtx(ctx)) return deny("Fitur ini hanya bisa dipakai lewat bot utama.");
  if (ctx.chat.type !== "private") return deny("🔒 Fitur Jadi Bot hanya bisa dipakai di chat pribadi bot (menyangkut token).");
  const uid = ctx.from.id;
  if (!canJadibot(uid)) return deny("💎 Fitur Jadi Bot khusus pengguna Premium ke atas.");

  const mine = getClone(uid);
  let rich;
  let rows;
  if (mine) {
    rich =
      title("🤖", "Jadi Bot") +
      table(["Info", "Status"], [
        ["Bot kamu", `<b>@${esc(mine.username)}</b>`],
        ["Status", "🟢 Aktif"],
        ["Fitur", `Semua fitur ${esc(config.botName)}`],
      ]) +
      quote("Tambahkan botmu ke grup lalu jadikan admin untuk memakai fitur moderasi.");
    rows = [[{ text: "Hentikan Bot", icon_custom_emoji_id: "5319109106793986870", emoji_fallback: "⏹️", callback_data: "jadibot:stop" }], back(uid)];
  } else {
    rich =
      title("🤖", "Jadi Bot") +
      para(`Jalankan salinan <b>${esc(config.botName)}</b> dengan bot milikmu sendiri.`) +
      table(["Langkah", "Keterangan"], [
        ["1", "Buka @BotFather → /newbot (atau pakai bot yang sudah ada)"],
        ["2", "Salin <b>token</b>-nya"],
        ["3", "Tekan <b>Kirim Token</b> lalu tempel token di sini"],
      ]) +
      quote("<i>Token hanya dipakai untuk menjalankan botmu dan pesan tokenmu langsung dihapus. Khusus Premium ke atas.</i>");
    rows = [[{ text: "Kirim Token", icon_custom_emoji_id: "5330115548900501467", emoji_fallback: "🔑", callback_data: "jadibot:ask" }], back(uid)];
  }
  await editOrSend(ctx, rich, rows);
  if (viaButton) await ctx.answerCbQuery().catch(() => {});
}

registerCallback("jadibot", async (ctx, args) => {
  const uid = ctx.from.id;
  if (isCloneCtx(ctx) || ctx.chat?.type !== "private" || !canJadibot(uid)) return ctx.answerCbQuery("Tidak tersedia.", { show_alert: true });
  const act = args[0];
  if (act === "ask") {
    pending.set(String(uid), Date.now() + PENDING_TTL);
    await ctx.answerCbQuery().catch(() => {});
    return sendView(ctx.telegram, ctx.chat.id, note("🔑", "Kirim token bot", "Kirim <b>token bot</b> dari @BotFather sekarang (berlaku 5 menit)."), [[{ text: "Batalkan", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: "jadibot:cancel" }]]);
  }
  if (act === "cancel") {
    pending.delete(String(uid));
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Dibatalkan.");
  }
  if (act === "stop") {
    const c = await stopClone(uid);
    await ctx.answerCbQuery(c ? "Bot dihentikan." : "Tidak ada bot yang berjalan.", { show_alert: true }).catch(() => {});
    return showJadibotMenu(ctx).catch(() => {});
  }
  return ctx.answerCbQuery();
});

/** Proses token yang dikirim user. Pesan berisi token selalu dihapus. */
export async function handleToken(ctx, token) {
  pending.delete(String(ctx.from.id));
  await ctx.deleteMessage().catch(() => {}); // sembunyikan token dari riwayat chat
  const wait = await sendView(ctx.telegram, ctx.chat.id, note("⏳", "Memeriksa token", "Menjalankan botmu, mohon tunggu...")).catch(() => null);
  const show = (rich) => (wait ? editView(ctx.telegram, wait.chat.id, wait.message_id, rich) : sendView(ctx.telegram, ctx.chat.id, rich));
  try {
    const me = await startClone(ctx.from.id, token);
    await show(
      title("✅", "Berhasil!") +
        table(["Info", "Status"], [["Bot", `<b>@${esc(me.username)}</b>`], ["Status", "🟢 Aktif"]]) +
        quote("Ketik /start di bot itu untuk mencoba. Hentikan kapan saja dengan /stopjadibot.")
    );
    for (const o of allOwnerIds()) {
      if (String(o) !== String(ctx.from.id)) {
        notify(ctx.telegram, o, note("🤖", "Jadi Bot", `${esc(ctx.from.first_name)} (<code>${ctx.from.id}</code>) menjalankan @${esc(me.username)}.`));
      }
    }
  } catch (err) {
    await show(note("❌", "Gagal menjalankan bot", esc(err.message)));
  }
}

/** Middleware teks: tangkap token saat user sedang diminta mengirim token (chat pribadi, bot utama saja) */
export async function jadibotTextHandler(ctx, next) {
  if (isCloneCtx(ctx) || ctx.chat?.type !== "private" || !ctx.from) return next();
  const exp = pending.get(String(ctx.from.id));
  if (!exp) return next();
  if (exp < Date.now()) { pending.delete(String(ctx.from.id)); return next(); }
  const text = String(ctx.message?.text || "").trim();
  if (/^\/[a-z0-9_]+(@\w+)?(\s|$)/i.test(text)) return next(); // perintah biasa tetap jalan
  if (!TOKEN_RE.test(text)) {
    return replyView(ctx, note("⚠️", "Format token tidak dikenali", "Contoh: <code>123456789:AAH...</code><br>Salin ulang dari @BotFather, atau batalkan lewat tombol."));
  }
  return handleToken(ctx, text);
}

export { TOKEN_RE };

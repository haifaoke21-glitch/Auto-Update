import { getMainTelegram } from "./jadibot.js";
import config from "../../config.js";
import { isOwner } from "../middleware.js";
import { registerCallback } from "./callbacks.js";

// Wajib join channel. Daftar channel diatur di config.js -> forceJoin.channels
// Syarat: bot harus admin di channel tsb agar getChatMember bisa dipakai.

const PLACEHOLDER = /^@?username_channel_\d+$/i; // nilai bawaan config.js = belum diisi
const JOINED = new Set(["creator", "administrator", "member"]);
const CACHE_TTL = 60 * 1000; // hasil "sudah join" disimpan 1 menit agar tidak membebani API
const PROMPT_GAP = 4 * 1000; // jeda minimal antar pesan peringatan ke user yang sama

const joinedCache = new Map(); // "userId:@channel" -> waktu kedaluwarsa
const lastPrompt = new Map(); // userId -> waktu terakhir peringatan dikirim
const warned = new Set(); // channel yang gagal dicek (log sekali saja)

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "https://t.me/nama", "@nama", "nama" -> "@nama" */
export function normalizeChannel(v) {
  const name = String(v ?? "")
    .trim()
    .replace(/^https?:\/\/(t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?]/)[0];
  return name ? "@" + name : "";
}

/** Channel wajib join yang valid (placeholder & kosong dibuang). Kosong = fitur nonaktif */
export function getChannels() {
  const fj = config.forceJoin;
  if (!fj || fj.enabled === false) return [];
  const list = (Array.isArray(fj.channels) ? fj.channels : []).map(normalizeChannel);
  return [...new Set(list.filter((c) => c && !PLACEHOLDER.test(c)))];
}

async function isMember(telegram, userId, channel) {
  const key = `${userId}:${channel.toLowerCase()}`;
  if ((joinedCache.get(key) || 0) > Date.now()) return true;
  try {
    const m = await telegram.getChatMember(channel, userId);
    const ok = JOINED.has(m.status) || (m.status === "restricted" && m.is_member === true);
    if (ok) joinedCache.set(key, Date.now() + CACHE_TTL);
    else joinedCache.delete(key);
    warned.delete(channel);
    return ok;
  } catch (err) {
    // Channel salah / bot bukan admin / error jaringan.
    // strict (default) = TOLAK user karena keanggotaan tidak bisa dibuktikan.
    // strict: false    = lewati channel ini supaya salah setting tidak memblokir semua user.
    const strict = config.forceJoin?.strict !== false;
    if (!warned.has(channel)) {
      warned.add(channel);
      console.warn(
        `[FORCEJOIN] Tidak bisa mengecek ${channel}: ${err.description || err.message}. ` +
          `Pastikan username benar dan bot sudah jadi admin di channel itu. ` +
          (strict ? "User ditolak sampai bisa dicek." : "Channel ini dilewati sementara.")
      );
    }
    return !strict;
  }
}

/** true = user boleh memakai bot (owner selalu boleh). Tanpa mengirim pesan apa pun. */
export async function hasJoinedAll(telegram, userId) {
  if (!getChannels().length) return true;
  if (isOwner(userId)) return true;
  const status = await membership(telegram, userId);
  return status.every(([, ok]) => ok);
}

/** Bot clone bukan admin channel wajib join -> cek keanggotaan selalu lewat bot utama */
const tg = (telegram) => getMainTelegram() || telegram;

/** [[channel, sudahJoin], ...] */
async function membership(telegram, userId) {
  return Promise.all(getChannels().map(async (c) => [c, await isMember(tg(telegram), userId, c)]));
}

function promptView(status) {
  const lines = status.map(([c, ok]) => `${ok ? "✅" : "❌"} ${esc(c)}`).join("\n");
  const text =
    `<tg-emoji emoji-id="6129731845442510016">🔒</tg-emoji> <b>Kamu harus join channel dulu</b>\n\n` +
    `Untuk memakai bot ini, join semua channel berikut:\n\n${lines}\n\n` +
    `Setelah join, tekan tombol <b>Saya sudah join</b> lalu ulangi perintahmu.`;
  const rows = status
    .filter(([, ok]) => !ok)
    .map(([c]) => [{ text: `Join ${c}`, icon_custom_emoji_id: "5215668805199473901", emoji_fallback: "📢", url: `https://t.me/${c.slice(1)}` }]);
  rows.push([{ text: "Saya sudah join", icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "✅", callback_data: "fj:check" }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

/**
 * Dipanggil sebelum menjalankan command. Return true = boleh lanjut.
 * Kalau belum join, kirim pesan peringatan (dibatasi) dan return false.
 */
export async function requireJoin(ctx, commandName) {
  if (!getChannels().length) return true;
  if (isOwner(ctx.from.id)) return true;
  if ((config.forceJoin?.exemptCommands || []).map((c) => String(c).toLowerCase()).includes(commandName)) return true;

  const status = await membership(ctx.telegram, ctx.from.id);
  if (status.every(([, ok]) => ok)) return true;

  const now = Date.now();
  if (now - (lastPrompt.get(ctx.from.id) || 0) >= PROMPT_GAP) {
    lastPrompt.set(ctx.from.id, now);
    const view = promptView(status);
    await ctx
      .reply(view.text, {
        parse_mode: "HTML",
        reply_markup: view.reply_markup,
        disable_web_page_preview: true,
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      })
      .catch((err) => console.warn("[FORCEJOIN] Gagal kirim peringatan:", err.message));
  }
  return false;
}

/**
 * Gate untuk tombol inline (callback_query). Tombol "fj" sendiri selalu lolos.
 * Return true = boleh lanjut; kalau belum join, tampilkan alert penolakan.
 */
export async function requireJoinCallback(ctx) {
  const data = ctx.callbackQuery?.data || "";
  if (data.startsWith("fj:")) return true;
  if (await hasJoinedAll(ctx.telegram, ctx.from.id)) return true;
  const status = await membership(ctx.telegram, ctx.from.id);
  const missing = status.filter(([, ok]) => !ok).map(([c]) => c);
  await ctx
    .answerCbQuery(`🔒 Join dulu: ${missing.join(", ")}\nLalu ketik /start.`, { show_alert: true })
    .catch(() => {});
  return false;
}

// Tombol "Saya sudah join": cek ulang keanggotaan user yang menekan
registerCallback("fj", async (ctx) => {
  const status = await membership(ctx.telegram, ctx.from.id);
  const missing = status.filter(([, ok]) => !ok).map(([c]) => c);
  if (missing.length) {
    return ctx.answerCbQuery(`❌ Kamu belum join: ${missing.join(", ")}`, { show_alert: true });
  }
  await ctx.answerCbQuery("✅ Terima kasih, verifikasi berhasil!");
  await ctx
    .editMessageText("<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> <b>Verifikasi berhasil!</b>\nSilakan ulangi perintahmu.", { parse_mode: "HTML" })
    .catch(() => {});
});

/** Dipakai saat bot start: cek tiap channel bisa dibaca & bot adalah admin. Return array laporan */
export async function checkChannelsAtStartup(telegram, botId) {
  const fj = config.forceJoin;
  if (!fj || fj.enabled === false) return { enabled: false, report: [] };

  const channels = getChannels();
  const report = [];
  for (const c of channels) {
    try {
      const chat = await telegram.getChat(c);
      const me = await telegram.getChatMember(chat.id, botId);
      const admin = ["administrator", "creator"].includes(me.status);
      report.push({ channel: c, ok: admin, note: admin ? chat.title || "" : "bot belum jadi admin di channel ini" });
    } catch (err) {
      report.push({ channel: c, ok: false, note: err.description || err.message });
    }
  }
  return { enabled: true, configured: channels.length, report };
}

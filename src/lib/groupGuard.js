import config from "../../config.js";
import { getGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { isAdminFast } from "./adminCache.js";
import { isStrict, strictMute, STRICT_MUTE_SEC } from "./strictMode.js";
import { fmtDuration } from "./groupUtil.js";

// Anti promosi + anti forward untuk grup. Diaktifkan per grup lewat /antipromosi dan /antiforward.
// Admin grup, owner bot, dan admin anonim tidak terkena filter.

const TELEGRAM_SERVICE = 777000; // akun resmi Telegram (forward otomatis dari channel tertaut)
const NOTICE_TTL = 6000; // pesan peringatan dihapus otomatis setelah 6 detik
const NOTICE_GAP = 10000; // maks 1 peringatan per user per 10 detik (hindari flood saat album/spam)

// Link undangan / ajakan join yang selalu dianggap promosi
export const PROMO_LINKS = [
  /(?:^|[^a-z0-9.])(?:t|telegram)\.(?:me|dog)\/\S+/i, // t.me, telegram.me, telegram.dog
  /tg:\/\/(?:join|resolve)/i,
  /joinchat/i,
  /chat\.whatsapp\.com\//i,
  /(?:^|[^a-z0-9.])wa\.me\//i,
  /whatsapp\.com\/channel\//i,
  /discord\.(?:gg|com\/invite)\//i,
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escHtml = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Regex kata kunci & domain dari config.js (antiPromo.keywords / antiPromo.domains), dibangun sekali
const words = (a) => (Array.isArray(a) ? a : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
const kw = words(config.antiPromo?.keywords);
const dom = words(config.antiPromo?.domains);
const KEYWORD_RE = kw.length
  ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${kw.map(escRe).join("|")})(?![\\p{L}\\p{N}])`, "iu")
  : null;
const DOMAIN_RE = dom.length
  ? new RegExp(`(?:^|[^a-z0-9.-])(?:${dom.map(escRe).join("|")})(?![a-z0-9-])`, "i")
  : null;

/** Kumpulkan teks, caption, link tersembunyi (text_link) & tombol URL dari pesan */
export function collectText(msg) {
  const parts = [msg.text, msg.caption];
  for (const e of [...(msg.entities || []), ...(msg.caption_entities || [])]) {
    if (e.type === "text_link" && e.url) parts.push(e.url);
  }
  for (const row of msg.reply_markup?.inline_keyboard || []) {
    for (const b of row) if (b.url) parts.push(b.url);
  }
  return parts.filter(Boolean).join("\n");
}

export function isPromo(text) {
  if (!text) return false;
  return PROMO_LINKS.some((re) => re.test(text)) || Boolean(DOMAIN_RE?.test(text)) || Boolean(KEYWORD_RE?.test(text));
}

export function isForwarded(msg) {
  return Boolean(msg.forward_origin || msg.forward_date || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name);
}

const lastNotice = new Map();
const warnedNoPerm = new Set();

async function punish(ctx, msg, reason, next, strict = false) {
  const chatId = ctx.chat.id;
  // ANTI DELAY: hapus pesan & mute (Mode Ketat) dimulai bersamaan, tidak saling menunggu
  const delP = ctx.telegram.deleteMessage(chatId, msg.message_id).then(() => null, (err) => err);
  const muteP = strict ? strictMute(ctx.telegram, chatId, ctx.from.id) : null;

  const delErr = await delP;
  if (delErr) {
    // Bot bukan admin / tidak punya izin hapus pesan -> beri tahu grup sekali saja
    if (!warnedNoPerm.has(chatId)) {
      warnedNoPerm.add(chatId);
      console.warn(`[GROUPGUARD] Gagal hapus pesan di ${chatId}: ${delErr.description || delErr.message}`);
      ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Filter aktif tapi aku belum bisa menghapus pesan. Jadikan aku admin dengan izin <b>Hapus pesan</b>.", { parse_mode: "HTML" }).catch(() => {});
    }
    return next();
  }

  const uid = ctx.from?.id ?? msg.sender_chat?.id;
  const key = `${chatId}:${uid}`;
  const now = Date.now();
  if (now - (lastNotice.get(key) || 0) < NOTICE_GAP) return;
  lastNotice.set(key, now);
  if (lastNotice.size > 500) lastNotice.delete(lastNotice.keys().next().value);

  const name = ctx.from && !ctx.from.is_bot
    ? `<a href="tg://user?id=${ctx.from.id}">${escHtml(ctx.from.first_name || "User")}</a>`
    : escHtml(msg.sender_chat?.title || "Pengirim");

  // Peringatan dikirim di latar belakang (tidak menahan antrean update berikutnya)
  void (async () => {
    const muted = muteP ? await muteP : false;
    const tail = muted ? `\n<tg-emoji emoji-id="5213391561999526028">🔇</tg-emoji> Dimute <b>${fmtDuration(STRICT_MUTE_SEC)}</b> (Mode Ketat).` : "";
    const sent = await ctx.reply(`<tg-emoji emoji-id="5240241223632954241">🚫</tg-emoji> ${name}, ${reason}${tail}`, { parse_mode: "HTML" }).catch(() => null);
    if (sent) {
      const t = setTimeout(() => ctx.telegram.deleteMessage(sent.chat.id, sent.message_id).catch(() => {}), NOTICE_TTL);
      t.unref?.();
    }
  })();
}

/** Middleware: pasang sebelum handler lain, untuk semua jenis pesan (teks, foto, video, stiker, dst) */
export async function groupGuardHandler(ctx, next) {
  const chat = ctx.chat;
  const msg = ctx.message || ctx.editedMessage;
  if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
  if (msg.is_automatic_forward) return next(); // posting channel tertaut yang di-forward otomatis oleh Telegram

  const sc = msg.sender_chat;
  if (sc && sc.id === chat.id) return next(); // admin anonim
  const viaChannel = sc?.type === "channel"; // channel yang kirim atas nama dirinya sendiri
  if (!viaChannel && (!ctx.from || ctx.from.is_bot || ctx.from.id === TELEGRAM_SERVICE)) return next();

  const group = getGroup(chat.id);
  const edited = !ctx.message; // pesan yang diedit: hanya cek promosi (spammer sering edit belakangan)

  let reason = null;
  if (group.antiforward && !edited && isForwarded(msg)) {
    reason = "dilarang forward pesan di grup ini.";
  } else if (group.antipromosi && isPromo(collectText(msg))) {
    reason = "dilarang promosi di grup ini.";
  }
  if (!reason) return next();

  // Admin & owner bebas
  if (!viaChannel && (isOwner(ctx.from.id) || (await isAdminFast(ctx)))) return next();

  // Mode Ketat: mute hanya untuk user biasa (bukan channel yang kirim atas nama dirinya)
  return punish(ctx, msg, reason, next, isStrict(group) && !viaChannel && Boolean(ctx.from));
}

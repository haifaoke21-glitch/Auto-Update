// ═══════════════════════════════════════════════════════════════════════
//  CHAT OWNER VIA BOT (relay)
//  User menekan "Chat Owner via Bot" di /owner -> mode chat aktif (10 menit sejak pesan terakhir).
//  Pesan user (teks/foto/video/voice/file) diteruskan ke semua owner. Owner membalas dengan
//  REPLY ke pesan itu, dan balasannya dikirim ke user lewat bot. Perintah (/menu dll) tetap jalan normal.
// ═══════════════════════════════════════════════════════════════════════
import config from "../../config.js";
import { getUser } from "../database.js";
import { isOwner, allOwnerIds } from "../middleware.js";
import { getPlugin } from "../pluginLoader.js";
import { h, sendRich, editRich, richTable } from "./rich.js";

const TTL_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 3000; // jeda antar pesan user (anti spam)
const MAX_TEXT = 3000;

const chatState = new Map(); // userId -> { expires, last, count, msgId, chatId }
const relayMap = new Map(); // "ownerId:messageId" -> userId
const RELAY_CAP = 3000;

function remember(ownerId, messageId, userId) {
  relayMap.set(`${ownerId}:${messageId}`, String(userId));
  if (relayMap.size > RELAY_CAP) relayMap.delete(relayMap.keys().next().value);
}

const clockOf = (ts) => {
  try {
    return new Intl.DateTimeFormat("id-ID", { timeZone: config.timezone || config.coin?.timezone || "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
};

// ───────────────────────── Tampilan ─────────────────────────
export const promptView = () => ({
  rich:
    `<h2><tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> Chat Owner via Bot</h2>` +
    `<p>Ketik pesanmu sekarang (teks, foto, video, voice, atau file). Pesan diteruskan ke owner dan balasannya datang lewat bot ini.</p>` +
    `<blockquote><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Mode aktif ${TTL_MS / 60000} menit sejak pesan terakhir.<br>Perintah bot (mis. /menu) tetap berjalan normal.</blockquote>`,
  legacy:
    `<b><tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> Chat Owner via Bot</b>\n\nKetik pesanmu sekarang (teks, foto, video, voice, atau file). Pesan diteruskan ke owner dan balasannya datang lewat bot ini.\n\n` +
    `⏳ Mode aktif ${TTL_MS / 60000} menit sejak pesan terakhir.`,
});

const sentView = (count, until) => ({
  rich:
    `<h2><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Terkirim ke Owner</h2>` +
    richTable(["Status", "Detail"], [["Pesan terkirim", String(count)], ["Mode aktif sampai", clockOf(until)]]) +
    `<p>Masih ada yang mau disampaikan? Kirim saja pesan berikutnya. Kalau sudah cukup, tekan <b>Selesai</b>.</p>`,
  legacy: `<b><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Terkirim ke Owner</b>\n\nPesan terkirim: <b>${count}</b>\nMode aktif sampai: <b>${clockOf(until)}</b>\n\nKirim pesan berikutnya, atau tekan <b>Selesai</b>.`,
});

export const chatKeyboard = (uid, label) => ({
  inline_keyboard: [[{ text: label, callback_data: `owner:end:${uid}`, style: "danger" }]],
});

// ───────────────────────── Mode chat ─────────────────────────
export function startChat(userId, chatId, msgId) {
  chatState.set(String(userId), { expires: Date.now() + TTL_MS, last: 0, count: 0, msgId, chatId });
}
export const endChat = (userId) => chatState.delete(String(userId));
export const inChat = (userId) => chatState.has(String(userId));

/** Kirim prompt "ketik pesanmu" sebagai pesan baru (dipakai tombol Balas dari balasan owner) */
export async function openChatWithNewMessage(telegram, userId) {
  const m = await sendRich(telegram, userId, promptView(), { reply_markup: chatKeyboard(userId, "Batal") });
  startChat(userId, userId, m.message_id);
}

// ───────────────────────── Handler pesan ─────────────────────────
function looksLikeCommand(text) {
  if (!text) return false;
  if (text.startsWith("/")) return true;
  for (const p of config.altPrefixes || []) {
    if (p && text.startsWith(p)) {
      const word = text.slice(p.length).trim().split(/\s+/)[0]?.split("@")[0]?.toLowerCase();
      if (word && getPlugin(word)) return true;
    }
  }
  return false;
}

const nameOf = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "-";

async function relayToOwners(ctx) {
  const u = ctx.from;
  const msg = ctx.message;
  const isText = typeof msg.text === "string";
  const body = isText ? msg.text.slice(0, MAX_TEXT) : (msg.caption || "").slice(0, 900);
  const header =
    `<tg-emoji emoji-id="5372825386591732174">📩</tg-emoji> <b>Pesan dari user</b>\n` +
    `Nama: ${h(nameOf(u))}\n` +
    `Username: ${u.username ? "@" + h(u.username) : "-"}\n` +
    `ID: <code>${u.id}</code>` +
    (body ? `\n\n<blockquote>${h(body)}</blockquote>` : "") +
    `\n\n<i>Reply pesan ini untuk membalas.</i>`;

  let delivered = 0;
  for (const ownerId of allOwnerIds()) {
    try {
      const head = await ctx.telegram.sendMessage(ownerId, header, { parse_mode: "HTML" });
      remember(ownerId, head.message_id, u.id);
      if (!isText) {
        const copy = await ctx.telegram.copyMessage(ownerId, ctx.chat.id, msg.message_id, {
          reply_parameters: { message_id: head.message_id },
        });
        remember(ownerId, copy.message_id, u.id);
      }
      delivered++;
    } catch (err) {
      console.error(`[OWNERCHAT] gagal kirim ke owner ${ownerId}:`, err.response?.description || err.message);
    }
  }
  return delivered;
}

async function handleUserMessage(ctx, st) {
  const user = getUser(ctx.from.id);
  if (user.banned) return;

  const now = Date.now();
  if (now - st.last < MIN_GAP_MS) {
    return ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Tunggu beberapa detik sebelum kirim pesan lagi.", { parse_mode: "HTML" });
  }
  st.last = now;

  const delivered = await relayToOwners(ctx);
  if (!delivered) {
    return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Pesan belum bisa diteruskan. Owner mungkin belum memulai bot ini. Coba lagi nanti atau pakai tombol Chat Owner (Profil).", { parse_mode: "HTML" });
  }

  st.count++;
  st.expires = now + TTL_MS;
  if (st.msgId) await editRich(ctx.telegram, st.chatId, st.msgId, sentView(st.count, st.expires), chatKeyboard(ctx.from.id, "Selesai"));
}

async function handleOwnerReply(ctx, next) {
  const replied = ctx.message.reply_to_message;
  if (!replied) return next();

  let uid = relayMap.get(`${ctx.chat.id}:${replied.message_id}`);
  if (!uid && replied.from?.id === ctx.botInfo?.id) {
    const m = (replied.text || "").match(/\nID: (\d{5,})/); // tahan restart: ID dibaca dari teks header
    if (m) uid = m[1];
  }
  if (!uid) return next();

  const text = ctx.message.text || ctx.message.caption || "";
  if (looksLikeCommand(text)) return next(); // owner membalas pakai perintah (mis. /ban)

  const reply_markup = { inline_keyboard: [[{ text: "Balas Owner", icon_custom_emoji_id: "5443038326535759644", emoji_fallback: "💬", callback_data: `owner:reply:${uid}`, style: "primary" }]] };
  try {
    if (typeof ctx.message.text === "string") {
      await ctx.telegram.sendMessage(uid, `<tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> <b>Balasan dari Owner</b>\n\n${h(ctx.message.text.slice(0, MAX_TEXT))}`, { parse_mode: "HTML", reply_markup });
    } else {
      await ctx.telegram.sendMessage(uid, "<tg-emoji emoji-id=\"5443038326535759644\">💬</tg-emoji> <b>Balasan dari Owner</b>", { parse_mode: "HTML" });
      await ctx.telegram.copyMessage(uid, ctx.chat.id, ctx.message.message_id, { reply_markup });
    }
    await ctx.reply(`<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Terkirim ke <code>${h(uid)}</code>`, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
  } catch (err) {
    await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal kirim ke <code>${h(uid)}</code>: ${h(err.response?.description || err.message)}`, { parse_mode: "HTML" });
  }
}

export async function ownerChatHandler(ctx, next) {
  try {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot || !ctx.message) return next();

    if (isOwner(ctx.from.id)) return await handleOwnerReply(ctx, next);

    const st = chatState.get(String(ctx.from.id));
    if (!st) return next();
    if (st.expires < Date.now()) {
      chatState.delete(String(ctx.from.id));
      return next();
    }
    if (looksLikeCommand(ctx.message.text || ctx.message.caption || "")) return next();

    await handleUserMessage(ctx, st);
  } catch (err) {
    console.error("[OWNERCHAT]", err);
    try { await ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Terjadi kesalahan saat meneruskan pesan.", { parse_mode: "HTML" }); } catch { /* abaikan */ }
  }
}

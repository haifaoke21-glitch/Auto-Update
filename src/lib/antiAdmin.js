// ═══════════════════════════════════════════════════════════════════════
// ANTI ADMIN — member biasa dilarang me-mention / menandai admin grup.
//
// Aktif per grup lewat /antiadmin on | off (group.antiadmin). Pesan member yang berisi:
//   - @admin / @admins
//   - @username milik admin grup
//   - mention nama admin (text_mention)
// akan dihapus + peringatan singkat. Mention ke bot ini sendiri tetap boleh, dan admin/owner bebas.
// Daftar admin disimpan di cache 5 menit; admin dicek ulang langsung sebelum pesan dihapus.
// ═══════════════════════════════════════════════════════════════════════
import { getGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { isAdminFast } from "./adminCache.js";
import { mention, fullName, fmtDuration } from "./groupUtil.js";
import { isStrict, strictMute, STRICT_MUTE_SEC } from "./strictMode.js";

const TELEGRAM_SERVICE = 777000;
const CACHE_TTL = 60_000;
const NOTICE_TTL = 6000;
const NOTICE_GAP = 10_000;
const KEYWORDS = new Set(["@admin", "@admins"]);

const cache = new Map(); // chatId -> { at, ids:Set, names:Set }
const lastNotice = new Map();

async function adminInfo(tg, chatId) {
  const c = cache.get(chatId);
  if (c && Date.now() - c.at < CACHE_TTL) return c;
  try {
    const list = (await tg.getChatAdministrators(chatId)).filter((a) => !a.user.is_bot);
    const info = {
      at: Date.now(),
      ids: new Set(list.map((a) => a.user.id)),
      names: new Set(list.map((a) => (a.user.username || "").toLowerCase()).filter(Boolean)),
    };
    cache.set(chatId, info);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return info;
  } catch {
    return c || null;
  }
}

export async function antiAdminHandler(ctx, next) {
  try {
    const { chat, message: msg, from } = ctx;
    if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
    if (msg.is_automatic_forward || msg.sender_chat || !from || from.is_bot || from.id === TELEGRAM_SERVICE) return next();
    if (!getGroup(chat.id).antiadmin) return next();

    const text = msg.text ?? msg.caption;
    const ents = (msg.entities || msg.caption_entities || []).filter((e) => e.type === "mention" || e.type === "text_mention");
    if (!text || !ents.length) return next();

    const info = await adminInfo(ctx.telegram, chat.id);
    if (!info) return next();
    if (info.ids.has(from.id) || isOwner(from.id)) return next();

    const botName = String(ctx.botInfo?.username || "").toLowerCase();
    const hit = ents.some((e) => {
      if (e.type === "text_mention") return e.user && e.user.id !== from.id && info.ids.has(e.user.id);
      const tag = text.slice(e.offset, e.offset + e.length).toLowerCase();
      if (tag === `@${botName}`) return false;
      return KEYWORDS.has(tag) || (info.names.has(tag.slice(1)) && tag.slice(1) !== (from.username || "").toLowerCase());
    });
    if (!hit) return next();

    if (await isAdminFast(ctx)) { info.ids.add(from.id); return next(); } // admin baru yang belum masuk cache

    // ANTI DELAY: hapus pesan & mute (Mode Ketat) dimulai bersamaan, tidak saling menunggu
    const delP = ctx.telegram.deleteMessage(chat.id, msg.message_id).then(() => null, (err) => err);
    const muteP = isStrict(getGroup(chat.id)) ? strictMute(ctx.telegram, chat.id, from.id) : null;
    const delErr = await delP;
    if (delErr) {
      console.warn(`[ANTIADMIN] Gagal hapus pesan di ${chat.id}:`, delErr?.description || delErr?.message);
      return next();
    }

    const key = `${chat.id}:${from.id}`;
    const now = Date.now();
    if (now - (lastNotice.get(key) || 0) < NOTICE_GAP) return;
    lastNotice.set(key, now);
    if (lastNotice.size > 500) lastNotice.delete(lastNotice.keys().next().value);
    // Peringatan di latar belakang (tidak menahan antrean update)
    void (async () => {
      const muted = muteP ? await muteP : false;
      const tail = muted ? `\n<tg-emoji emoji-id="5213391561999526028">🔇</tg-emoji> Dimute <b>${fmtDuration(STRICT_MUTE_SEC)}</b> (Mode Ketat).` : "";
      const sent = await ctx.reply(`<tg-emoji emoji-id="5240241223632954241">🚫</tg-emoji> ${mention(from.id, fullName(from))}, dilarang menandai admin di grup ini.${tail}`, {
        parse_mode: "HTML",
        ...(msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
      }).catch(() => null);
      if (sent) {
        const t = setTimeout(() => ctx.telegram.deleteMessage(sent.chat.id, sent.message_id).catch(() => {}), NOTICE_TTL);
        t.unref?.();
      }
    })();
    return;
  } catch (e) {
    console.warn("[ANTIADMIN]", e?.description || e?.message || e);
  }
  return next();
}

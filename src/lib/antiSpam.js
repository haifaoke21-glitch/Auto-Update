// ═══════════════════════════════════════════════════════════════════════
// ANTI SPAM — tangkap spam berdasarkan ISI pesan (beda dengan Anti Flood yang berdasarkan kecepatan).
//
// Aktif per grup lewat /antispam on | off (group.antispam). Yang dianggap spam:
//   1. Pesan yang sama dikirim berulang   (3x dalam 30 detik)
//   2. Terlalu banyak mention             (lebih dari 5 @mention dalam satu pesan)
//   3. Karakter/emoji yang sama diulang   (20x atau lebih berturut-turut)
// Tindakan: pesan spam dihapus + peringatan singkat. Pelanggaran 3x dalam 5 menit => mute 10 menit.
// Mode Ketat (/modeketat on): pelanggaran PERTAMA langsung dimute 30 menit.
// Admin grup, owner bot, bot, dan admin anonim tidak terkena.
// ═══════════════════════════════════════════════════════════════════════
import { getGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { isAdminFast } from "./adminCache.js";
import { sendView, note } from "./richUi.js";
import { E } from "./emo.js";
import { MUTE_PERMS, mention, fullName, fmtDuration } from "./groupUtil.js";
import { isStrict, STRICT_MUTE_SEC } from "./strictMode.js";

const TELEGRAM_SERVICE = 777000;
const DUP_LIMIT = 3;
const DUP_WINDOW = 30_000;
const MENTION_LIMIT = 5;
const REPEAT_RE = /(.)\1{19,}/su;
const STRIKE_LIMIT = 3;
const STRIKE_WINDOW = 5 * 60_000;
const MUTE_SEC = 600;
const NOTICE_TTL = 8000;
const NOTICE_GAP = 10_000;

const recent = new Map(); // "chat:user" -> [{ t, h, id }]
const strikes = new Map(); // "chat:user" -> [waktu pelanggaran]
const lastNotice = new Map();
const warnedPerm = new Map();

const trim = (map, max = 3000) => {
  if (map.size > max) map.delete(map.keys().next().value);
};

export async function antiSpamHandler(ctx, next) {
  try {
    const { chat, message: msg, from } = ctx;
    if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
    if (msg.is_automatic_forward || msg.sender_chat || !from || from.is_bot || from.id === TELEGRAM_SERVICE) return next();
    const grp = getGroup(chat.id);
    if (!grp.antispam) return next();
    const strict = isStrict(grp);

    const raw = msg.text ?? msg.caption;
    if (!raw) return next(); // hanya teks / caption

    const key = `${chat.id}:${from.id}`;
    const now = Date.now();
    const h = raw.toLowerCase().replace(/\s+/g, " ").trim();

    let list = (recent.get(key) || []).filter((x) => now - x.t < DUP_WINDOW);
    list.push({ t: now, h, id: msg.message_id });
    recent.set(key, list);
    trim(recent);

    const ents = [...(msg.entities || []), ...(msg.caption_entities || [])];
    const mentions = ents.filter((e) => e.type === "mention" || e.type === "text_mention").length;
    const same = h.length >= 4 ? list.filter((x) => x.h === h) : [];

    let reason = null;
    let ids = [msg.message_id];
    if (same.length >= DUP_LIMIT) { reason = "mengirim pesan yang sama berulang kali."; ids = same.map((x) => x.id); }
    else if (mentions > MENTION_LIMIT) reason = "terlalu banyak mention dalam satu pesan.";
    else if (REPEAT_RE.test(raw)) reason = "mengulang karakter/emoji secara berlebihan.";
    if (!reason) return next();

    if (isOwner(from.id) || (await isAdminFast(ctx))) { recent.delete(key); return next(); }

    recent.delete(key);
    const delP = Promise.all(ids.map((id) => ctx.telegram.deleteMessage(chat.id, id).catch(() => {}))); // hapus & mute bersamaan

    const hist = (strikes.get(key) || []).filter((t) => now - t < STRIKE_WINDOW);
    hist.push(now);
    let muted = false;
    const muteSec = strict ? STRICT_MUTE_SEC : MUTE_SEC;
    if (strict || hist.length >= STRIKE_LIMIT) {
      try {
        await ctx.telegram.restrictChatMember(chat.id, from.id, { permissions: MUTE_PERMS, until_date: Math.floor(now / 1000) + muteSec });
        muted = true;
        strikes.delete(key);
      } catch (err) {
        if (Date.now() - (warnedPerm.get(chat.id) || 0) > 600_000) {
          warnedPerm.set(chat.id, Date.now());
          await sendView(ctx.telegram, chat.id, note(E.warn, "Anti Spam belum bisa membisukan", "Jadikan bot <b>admin</b> dengan izin <b>Blokir pengguna</b> dan <b>Hapus pesan</b>.")).catch(() => {});
        }
      }
    }
    await delP;
    if (!muted) strikes.set(key, hist);
    trim(strikes);

    if (now - (lastNotice.get(key) || 0) < NOTICE_GAP) return;
    lastNotice.set(key, now);
    trim(lastNotice, 1000);
    const thread = msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
    const sent = await sendView(
      ctx.telegram, chat.id,
      note(E.deny, "Anti Spam", `${mention(from.id, fullName(from))} ${reason}${muted ? `<br>${E.mute} Dimute <b>${fmtDuration(muteSec)}</b> ${strict ? "(Mode Ketat)" : "karena berulang"}.` : ""}`),
      undefined, thread
    ).catch(() => null);
    if (sent?.message_id) {
      const t = setTimeout(() => ctx.telegram.deleteMessage(chat.id, sent.message_id).catch(() => {}), NOTICE_TTL);
      t.unref?.();
    }
    return;
  } catch (e) {
    console.warn("[ANTISPAM]", e?.description || e?.message || e);
  }
  return next();
}

// ═══════════════════════════════════════════════════════════════════════
// ANTI FLOOD — batasi member yang mengirim pesan terlalu cepat di grup.
//
// Per grup (atur lewat /antiflood): batas pesan (limit) dalam jangka waktu (detik).
// Kalau member melewati batas: semua pesan floodnya dihapus, lalu tindakan dijalankan
//   delete = hanya hapus · mute = bisukan (durasi) · kick = keluarkan · ban = blokir permanen.
// Admin grup, owner bot, bot, dan admin anonim tidak terkena. Album (banyak foto sekaligus) dihitung 1 pesan.
// Data hitungan ada di memori (tidak ke database). Pengaturan disimpan di group.antiflood.
// ═══════════════════════════════════════════════════════════════════════
import { getGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { isAdminFast } from "./adminCache.js";
import { sendView, note, quote } from "./richUi.js";
import { E } from "./emo.js";
import { MUTE_PERMS, fmtDuration } from "./groupUtil.js";
import { isStrict, STRICT_MUTE_SEC } from "./strictMode.js";

export const FLOOD_DEFAULT = { on: false, limit: 5, window: 5, action: "mute", muteSec: 600 };
export const FLOOD_ACTIONS = { delete: "Hapus pesan", mute: "Mute", kick: "Kick", ban: "Ban" };
// a = group.antiflood (objek pengaturan tersimpan, boleh kosong)
export const floodCfg = (a) => ({ ...FLOOD_DEFAULT, ...(a || {}) });

const TELEGRAM_SERVICE = 777000;
const NOTICE_TTL = 15000;
const hits = new Map(); // "chat:user" -> [{ t, id, mg }]
const cooldown = new Map(); // "chat:user" -> waktu tindakan terakhir
const warnedNoPerm = new Set();

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const who = (u) => `<a href="tg://user?id=${u.id}">${esc([u.first_name, u.last_name].filter(Boolean).join(" ") || "User")}</a>`;

async function deleteMany(tg, chatId, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      await tg.callApi("deleteMessages", { chat_id: chatId, message_ids: chunk });
    } catch {
      await Promise.all(chunk.map((id) => tg.deleteMessage(chatId, id).catch(() => {})));
    }
  }
}

function trim(map, max = 2000) {
  if (map.size > max) map.delete(map.keys().next().value);
}

export async function antiFloodHandler(ctx, next) {
  try {
    const chat = ctx.chat;
    const msg = ctx.message;
    if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
    if (msg.is_automatic_forward || msg.sender_chat) return next();
    const from = ctx.from;
    if (!from || from.is_bot || from.id === TELEGRAM_SERVICE) return next();

    const grp = getGroup(chat.id);
    const cfg = floodCfg(grp.antiflood);
    if (!cfg.on) return next();
    // Mode Ketat: tindakan "hapus"/"mute" jadi mute minimal 30 menit (kick/ban tetap sesuai setelan grup)
    const strict = isStrict(grp);
    const action = strict && (cfg.action === "delete" || cfg.action === "mute") ? "mute" : cfg.action;
    const muteSec = strict ? Math.max(cfg.muteSec, STRICT_MUTE_SEC) : cfg.muteSec;

    const key = `${chat.id}:${from.id}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((x) => now - x.t < cfg.window * 1000);
    const last = list[list.length - 1];
    if (!(msg.media_group_id && last?.mg === msg.media_group_id)) list.push({ t: now, id: msg.message_id, mg: msg.media_group_id });
    else last.ids = [...(last.ids || []), msg.message_id];
    hits.set(key, list);
    trim(hits);

    // Sedang dalam jeda setelah tindakan: pesan lanjutan langsung dihapus
    if (now - (cooldown.get(key) || 0) < 8000) {
      ctx.telegram.deleteMessage(chat.id, msg.message_id).catch(() => {});
      return;
    }
    if (list.length <= cfg.limit) return next();

    // Melewati batas: admin & owner bebas
    if (isOwner(from.id) || (await isAdminFast(ctx))) { hits.delete(key); return next(); }

    cooldown.set(key, now);
    trim(cooldown);
    hits.delete(key);
    const ids = list.flatMap((x) => [x.id, ...(x.ids || [])]);
    const delP = deleteMany(ctx.telegram, chat.id, ids); // hapus & tindak berjalan bersamaan (tanpa menunggu)

    let done = "";
    let failed = null;
    try {
      if (action === "mute") {
        await ctx.telegram.restrictChatMember(chat.id, from.id, { permissions: MUTE_PERMS, until_date: Math.floor(Date.now() / 1000) + Math.max(30, muteSec) });
        done = `${E.mute} Dimute selama <b>${fmtDuration(muteSec)}</b>${strict ? " (Mode Ketat)" : ""}.`;
      } else if (action === "kick") {
        await ctx.telegram.banChatMember(chat.id, from.id);
        await ctx.telegram.unbanChatMember(chat.id, from.id, { only_if_banned: true });
        done = `${E.kick} Dikeluarkan dari grup.`;
      } else if (action === "ban") {
        await ctx.telegram.banChatMember(chat.id, from.id);
        done = `${E.deny} Diblokir dari grup.`;
      } else {
        done = `${E.deny} Pesannya dihapus.`;
      }
    } catch (err) {
      failed = err;
    }
    await delP;

    if (failed && !warnedNoPerm.has(chat.id)) {
      warnedNoPerm.add(chat.id);
      await sendView(ctx.telegram, chat.id, note(E.warn, "Anti Flood belum bisa menindak", "Jadikan bot <b>admin</b> dengan izin <b>Hapus pesan</b> dan <b>Blokir pengguna</b>.")).catch(() => {});
      return;
    }
    if (failed) return;

    const thread = msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
    const sent = await sendView(
      ctx.telegram, chat.id,
      note(E.warn, "Anti Flood", `${who(from)} mengirim pesan terlalu cepat.`) +
        quote(done, `Batas: <b>${cfg.limit}</b> pesan / <b>${cfg.window}</b> detik`),
      undefined, thread
    ).catch(() => null);
    const m = sent?.message_id ? sent : null;
    if (m) {
      const t = setTimeout(() => ctx.telegram.deleteMessage(m.chat?.id ?? chat.id, m.message_id).catch(() => {}), NOTICE_TTL);
      t.unref?.();
    }
    return;
  } catch (e) {
    console.warn("[ANTIFLOOD]", e?.description || e?.message || e);
  }
  return next();
}

// ═══════════════════════════════════════════════════════════════════════
// WARN GRUP — tampilan Rich Message + tombol Mute / Reset Warn
//
// Kartu warn = judul, tabel detail (member, warn n/batas + bar, sisa, pemberi), kutipan alasan, dan tombol:
//   🔇 Mute  (jadi 🔊 Unmute setelah dipencet)   ♻️ Reset Warn
// Tombol hanya bisa dipakai admin grup / owner bot (dicek ulang saat ditekan). Kartu diperbarui di tempat.
// callback_data: wn:<aksi>:<idTarget>   aksi: m = mute, u = unmute, r = reset warn
// ═══════════════════════════════════════════════════════════════════════
import { getGroup, saveGroup, usersDb } from "../database.js";
import { isOwner, isGroupAdmin } from "../middleware.js";
import { registerCallback } from "./callbacks.js";
import { title, table, quote, replyView, editView, h } from "./richUi.js";
import { MUTE_PERMS, botMember, mention, fullName, friendlyError } from "./groupUtil.js";
import { E } from "./emo.js";

export const DEFAULT_MAX_WARN = 3;
export const maxWarn = (g) => Math.min(Math.max(parseInt(g.warnLimit) || DEFAULT_MAX_WARN, 1), 20);

/** Bar progres: ▰▰▱ (terisi = jumlah warn) */
export const bar = (count, limit) => "▰".repeat(Math.min(count, limit)) + "▱".repeat(Math.max(limit - count, 0));

/** Nama (mention) + ID di dalam spoiler: ketuk untuk membuka */
export const who = (id, name) => `${mention(id, name)} (<tg-spoiler><code>${h(id)}</code></tg-spoiler>)`;

// Data kartu yang tidak ada di database (alasan, pemberi, status mute) — di memori, maksimal 300 kartu terakhir
const cards = new Map();
const keyOf = (chatId, msgId) => `${chatId}:${msgId}`;
function remember(chatId, msgId, st) {
  cards.set(keyOf(chatId, msgId), st);
  if (cards.size > 300) cards.delete(cards.keys().next().value);
}

/** Tombol kartu: Mute/Unmute, dan Reset Warn selama warn masih > 0 */
function buttons(chatId, st) {
  const count = getGroup(chatId).warns?.[String(st.id)] || 0;
  const row = [
    st.muted
      ? { text: "Unmute", icon_custom_emoji_id: "5213391561999526028", emoji_fallback: "🔊", callback_data: `wn:u:${st.id}` }
      : { text: "Mute", icon_custom_emoji_id: "5213391561999526028", emoji_fallback: "🔇", callback_data: `wn:m:${st.id}` },
  ];
  if (count > 0) row.push({ text: "Reset Warn", icon_custom_emoji_id: "6251145511428950009", emoji_fallback: "♻️", callback_data: `wn:r:${st.id}` });
  return [row];
}

/**
 * Kartu warn -> { rich, rows }.
 * st = { id, name, reason?, by?: {id,name}, kind?: "warn"|"cek", note?, muted?: {by}, resetBy?: {id,name}, noButtons? }
 */
export function warnCard(chatId, st) {
  const g = getGroup(chatId);
  const limit = maxWarn(g);
  const count = g.warns?.[String(st.id)] || 0;
  const rows = [
    [`${E.user} Member`, who(st.id, st.name)],
    [`${E.warn} Warn`, `<b>${count}/${limit}</b> ${bar(count, limit)}`],
    [`${E.wait} Sisa`, count >= limit ? "batas tercapai" : `${limit - count} warn sebelum dikick`],
  ];
  if (st.by) rows.push([`${E.shield} Oleh`, mention(st.by.id, st.by.name)]);
  if (st.muted) rows.push([`${E.mute} Status`, `Dimute oleh ${mention(st.muted.by.id, st.muted.by.name)}`]);
  if (st.resetBy) rows.push([`${E.reset} Reset`, `Warn direset oleh ${mention(st.resetBy.id, st.resetBy.name)}`]);

  const rich =
    title(st.kind === "cek" ? E.list : E.warn, st.kind === "cek" ? "Cek Warn" : "Peringatan Member") +
    table(["Detail", "Info"], rows) +
    (st.reason ? quote(`${E.note} <b>Alasan</b>`, h(st.reason)) : "") +
    (st.note ? quote(st.note) : "");
  return { rich, rows: st.noButtons ? undefined : buttons(chatId, st) };
}

/** Kirim kartu warn sebagai balasan perintah dan ingat datanya untuk tombol */
export async function sendWarnCard(ctx, st) {
  const { rich, rows } = warnCard(ctx.chat.id, st);
  const sent = await replyView(ctx, rich, rows).catch((e) => console.warn("[WARN] kirim kartu gagal:", e?.message || e));
  if (sent && rows) remember(ctx.chat.id, sent.message_id, st);
  return sent;
}

const person = (u) => ({ id: u.id, name: fullName(u) });
const cleanErr = (e) => friendlyError(e, "mute").replace(/<[^>]*>/g, "");

registerCallback("wn", async (ctx, [action, tid]) => {
  const msg = ctx.callbackQuery?.message;
  if (!msg || !ctx.chat || ctx.chat.type === "private") return ctx.answerCbQuery();
  if (!(isOwner(ctx.from.id) || (await isGroupAdmin(ctx)))) {
    return ctx.answerCbQuery("Hanya admin grup yang bisa memakai tombol ini.", { show_alert: true });
  }
  const chatId = ctx.chat.id;
  const admin = person(ctx.from);

  // data kartu (kalau bot pernah restart, dasar-nya dibangun ulang dari id target)
  let st = cards.get(keyOf(chatId, msg.message_id));
  if (!st) {
    let name = usersDb.data.users?.[tid]?.name || tid;
    try { name = fullName((await ctx.telegram.getChatMember(chatId, Number(tid))).user); } catch {}
    st = { id: tid, name };
  }
  const refresh = async () => {
    remember(chatId, msg.message_id, st);
    const { rich, rows } = warnCard(chatId, st);
    await editView(ctx.telegram, chatId, msg.message_id, rich, rows);
  };

  if (action === "r") {
    const g = getGroup(chatId);
    g.warns ||= {};
    g.warns[String(tid)] = 0;
    await saveGroup(chatId, { warns: g.warns });
    st.resetBy = admin;
    await refresh();
    return ctx.answerCbQuery("Warn direset ✓");
  }

  if (action === "m") {
    const bm = await botMember(ctx);
    if (!bm || !["administrator", "creator"].includes(bm.status) || (bm.status === "administrator" && bm.can_restrict_members === false)) {
      return ctx.answerCbQuery("Bot harus admin dengan izin Blokir pengguna.", { show_alert: true });
    }
    try {
      const t = await ctx.telegram.getChatMember(chatId, Number(tid));
      if (["creator", "administrator"].includes(t.status)) return ctx.answerCbQuery("Tidak bisa mute admin grup.", { show_alert: true });
      // tanpa until_date = permanen, sampai admin menekan Unmute (atau /unmute)
      await ctx.telegram.restrictChatMember(chatId, Number(tid), { permissions: MUTE_PERMS });
    } catch (e) {
      return ctx.answerCbQuery(cleanErr(e).slice(0, 190), { show_alert: true });
    }
    st.muted = { by: admin };
    await refresh();
    return ctx.answerCbQuery("Dimute ✓");
  }

  if (action === "u") {
    try {
      const chat = await ctx.telegram.getChat(chatId);
      const perms = chat.permissions || {
        can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
        can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
        can_send_other_messages: true, can_add_web_page_previews: true,
      };
      await ctx.telegram.restrictChatMember(chatId, Number(tid), { permissions: { ...perms, can_send_messages: true } });
    } catch (e) {
      return ctx.answerCbQuery(cleanErr(e).slice(0, 190), { show_alert: true });
    }
    st.muted = null;
    await refresh();
    return ctx.answerCbQuery("Mute dibuka ✓");
  }

  return ctx.answerCbQuery();
});

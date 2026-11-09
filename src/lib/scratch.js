import config from "../../config.js";

// Chat yang pernah gagal dipakai sebagai "penampung" (mis. owner belum /start bot) -> dilewati berikutnya
const bad = new Set();

/**
 * Upload media ke chat penampung hanya untuk mendapat file_id, lalu pesannya dihapus lagi.
 * Dipakai untuk Rich Message yang butuh file_id (audio, video, foto hasil unduhan).
 * Urutan chat: owner dulu (supaya tidak terlihat di chat pemakai), terakhir chat pemakai sendiri.
 * kind: "photo" | "audio" | "video"  ->  return file_id atau null
 */
export async function uploadForFileId(ctx, kind, source, extra = {}) {
  const own = String(ctx.chat.id);
  const candidates = [...new Set([...(config.ownerIds || []).map(String), own])].filter((c) => c === own || !bad.has(c));
  for (const chatId of candidates) {
    try {
      const opts = { disable_notification: true, ...extra };
      let m, id;
      if (kind === "photo") { m = await ctx.telegram.sendPhoto(chatId, source, opts); id = m.photo?.at(-1)?.file_id; }
      else if (kind === "audio") { m = await ctx.telegram.sendAudio(chatId, source, opts); id = m.audio?.file_id; }
      else { m = await ctx.telegram.sendVideo(chatId, source, opts); id = (m.video || m.animation || m.document)?.file_id; }
      ctx.telegram.deleteMessage(chatId, m.message_id).catch(() => {});
      if (id) return id;
    } catch {
      if (chatId !== own) bad.add(chatId);
    }
  }
  return null;
}

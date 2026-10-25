// Kirim block Rich Message (hasil /buildrich & /autorich) lewat sendRichMessage.
// Urutan percobaan: block asli -> blockquote klasik -> tanpa blockquote/pre -> HTML biasa (foto = sendPhoto).
import { transformRichMessage, stripEmojiMarkers } from "./richEmoji.js";
import { blocksToHtml, needsDowngrade, downgradeBlocks, classicQuotes, hasExpandableQuote } from "./richBuild.js";

// error yang tidak akan membaik dengan mencoba format lain -> langsung dilempar ke pemanggil (rate limit & migrasi supergroup diurus pemanggil)
const FATAL = /forbidden|blocked|kicked|deactivated|chat not found|can't initiate|not enough rights|too many requests|retry after|\b429\b|upgraded to a supergroup|migrate_to_chat_id/i;

/** Parameter umum balasan: reply ke pesan perintah + topik forum bila ada */
function replyExtra(ctx) {
  const m = ctx.message || {};
  return {
    ...(m.message_id ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } } : {}),
    ...(m.is_topic_message && m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}),
  };
}

/**
 * @param {import("telegraf").Context} ctx
 * @param {Array} blocks block hasil parseRichMarkup / generateRichBlocks
 * @param {string|null} photoFileId file_id foto (opsional) -> ditempel di atas pesan
 * @returns {Promise<"rich"|"html">} jalur yang berhasil dipakai
 */
export async function sendRichBlocks(ctx, blocks, photoFileId = null) {
  const attempts = [{ label: "asli", data: blocks }];
  if (hasExpandableQuote(blocks)) attempts.push({ label: "blockquote klasik", data: classicQuotes(blocks) });
  if (needsDowngrade(blocks)) attempts.push({ label: "tanpa blockquote/pre", data: downgradeBlocks(blocks) });

  for (const { label, data } of attempts) {
    try {
      const all = photoFileId ? [{ type: "photo", photo: { type: "photo", media: photoFileId } }, ...data] : data;
      await ctx.telegram.callApi("sendRichMessage", {
        chat_id: ctx.chat.id,
        rich_message: transformRichMessage({ blocks: all }), // {ID|emoji} -> custom emoji
        ...replyExtra(ctx),
      });
      return "rich";
    } catch (err) {
      if (FATAL.test(err?.message || "")) throw err;
      console.warn(`[RICH] sendRichMessage (${label}) gagal:`, err?.message);
    }
  }

  // Cadangan: HTML biasa (server Bot API belum mendukung Rich Message / block ditolak)
  const html = blocksToHtml(blocks);
  const extra = { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...replyExtra(ctx) };
  if (photoFileId) {
    if (html.length <= 1000) await ctx.telegram.sendPhoto(ctx.chat.id, photoFileId, { caption: html, ...extra });
    else {
      await ctx.telegram.sendPhoto(ctx.chat.id, photoFileId, { ...replyExtra(ctx) });
      await ctx.telegram.sendMessage(ctx.chat.id, html, extra);
    }
  } else {
    await ctx.telegram.sendMessage(ctx.chat.id, html, extra);
  }
  return "html";
}

export { stripEmojiMarkers };

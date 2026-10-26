import config from "../../config.js";
import * as idPrem from "../../src/lib/idPrem.js";

// ═════════ /idprem - CEK ID EMOJI PREMIUM (kategori tools, khusus owner) ═════════
// Cara pakai:
//   1) Reply pesan berisi emoji premium            -> /idprem
//   2) Reply pack emoji (stiker emoji / link t.me/addemoji/...) -> /idprem
//   3) Langsung: /idprem <nama_pack | link_pack>
//   4) Reply emoji premium + /idprem pack          -> keluarkan satu pack-nya
// Hasil LANGSUNG dikirim semuanya sekaligus sebagai file .js (bukan 10 baris per halaman)
// dengan nama file "EmojiPrem By {namabot}.js".

const USAGE =
  "ℹ️ <b>/idprem</b> - cek ID emoji premium\n\n" +
  "• Reply pesan yang isinya emoji premium, lalu ketik <code>/idprem</code>\n" +
  "• Reply pack emoji (stiker emoji / link <code>t.me/addemoji/...</code>), lalu ketik <code>/idprem</code>\n" +
  "• Atau langsung: <code>/idprem NamaPack</code> / <code>/idprem link_pack</code>\n" +
  "• Reply emoji premium + <code>/idprem pack</code> = keluarkan satu pack-nya\n\n" +
  "Semua hasil langsung dikirim sebagai file <code>EmojiPrem By {namabot}.js</code>.";

export default {
  command: ["idprem"],
  category: "tools",
  description: "Cek ID emoji premium dari pesan / pack emoji, hasil langsung diunduh semuanya sebagai file EmojiPrem By {namabot}.js",
  ownerOnly: false,
  cost: 0,
  loading: false,
  cooldown: 2000,
  run: async (ctx, { args }) => {
    try {
      const arg = (args || []).join(" ").trim();
      const replied = ctx.message.reply_to_message;
      const wantsPack = /^pack$/i.test(arg);
      const emojis = idPrem.extractCustomEmojis(replied);

      // Prioritas: arg (nama/link) > stiker yang di-reply > "pack" + emoji yang di-reply
      // > (kalau tidak ada emoji premium) link pack di pesan yang di-reply.
      let packName = wantsPack ? null : idPrem.parsePackArg(arg);
      if (!packName && replied) {
        if (replied.sticker?.set_name) {
          packName = String(replied.sticker.set_name);
        } else if (wantsPack && emojis.length) {
          const found = await ctx.telegram.getCustomEmojiStickers([emojis[0].id]);
          packName = found?.[0]?.set_name ? String(found[0].set_name) : null;
          if (!packName) return ctx.reply("❌ Emoji itu tidak punya pack yang bisa dibaca.");
        } else if (!emojis.length) {
          packName = idPrem.findPackNameInMessage(replied);
        }
      }

      let list;
      let title;
      if (packName) {
        const set = await ctx.telegram.getStickerSet(packName);
        if (!set || !Array.isArray(set.stickers)) return ctx.reply("❌ Pack emoji tidak ketemu.");
        if (set.sticker_type && set.sticker_type !== "custom_emoji") {
          return ctx.reply("❌ Itu pack stiker biasa, bukan pack emoji premium.");
        }
        list = idPrem.emojisFromStickers(set.stickers);
        title = `📦 ${set.title || set.name || packName} - ${list.length} emoji`;
      } else if (emojis.length) {
        list = emojis;
        title = `✨ ${list.length} emoji premium`;
      } else {
        return ctx.reply(USAGE, { parse_mode: "HTML" });
      }
      if (!list.length) return ctx.reply("❌ Tidak ada emoji premium yang bisa diambil.");

      // Kirim SEMUA hasil sekaligus sebagai file "EmojiPrem By {namabot}.js"
      const { text, filename, total, emojiCount } = idPrem.buildExportFile(list, title, config.botName);
      await ctx.telegram.sendDocument(
        ctx.chat.id,
        { source: Buffer.from(text, "utf-8"), filename },
        {
          caption: `📥 <b>Hasil /idprem</b>\n${idPrem.escapeHtml(title)}\n${total} ID · ${emojiCount} emoji`,
          parse_mode: "HTML",
          reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
          ...(ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
        }
      );
    } catch (error) {
      console.error("[IDPREM] Gagal:", error);
      const invalid = /STICKERSET_INVALID|sticker set|not found/i.test(String(error?.message));
      await ctx.reply(invalid ? "❌ Pack emoji tidak ketemu, cek lagi nama/link-nya." : "❌ Gagal ambil ID emoji, coba lagi.");
    }
  },
};

import sharp from "sharp";
import { getMediaBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["toimage"],
  category: "sticker",
  description: "Ubah stiker (non-animasi) jadi gambar. Balas stiker dengan /toimg",
  run: async (ctx) => {
    const st = ctx.message.reply_to_message?.sticker;
    if (!st) return ctx.reply("Balas sebuah stiker dengan /toimg.");
    if (st.is_animated || st.is_video) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Stiker animasi/video belum didukung.", { parse_mode: "HTML" });
    const buf = await getMediaBuffer(ctx, ["sticker"]);
    try {
      const png = await sharp(buf).png().toBuffer();
      await ctx.replyWithPhoto({ source: png });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

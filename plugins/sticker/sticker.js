import sharp from "sharp";
import { getMediaBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["s"],
  category: "sticker",
  description: "Ubah foto jadi stiker. Kirim foto + caption /s, atau balas foto dengan /s",
  cooldown: 3000,
  run: async (ctx) => {
    const buf = await getMediaBuffer(ctx, ["photo", "sticker", "document"]);
    if (!buf) return ctx.reply("Kirim foto dengan caption /s, atau balas foto dengan /s.");
    try {
      const webp = await sharp(buf)
        .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90 })
        .toBuffer();
      await ctx.replyWithSticker({ source: webp });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat stiker: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

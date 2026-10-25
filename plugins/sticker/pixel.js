import sharp from "sharp";
import { getMediaBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["pixel"],
  category: "sticker",
  description: "Pixelate foto. Balas foto dengan /pixel [ukuran 4-64]",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const buf = await getMediaBuffer(ctx, ["photo", "sticker", "document"]);
    if (!buf) return ctx.reply("Kirim foto dengan caption /pixel, atau balas foto dengan /pixel.");
    const block = Math.min(Math.max(parseInt(args[0]) || 12, 4), 64);
    try {
      const meta = await sharp(buf).metadata();
      const w = Math.max(Math.round(meta.width / block), 1);
      const small = await sharp(buf).resize(w, null, { kernel: "nearest" }).toBuffer();
      const out = await sharp(small).resize(meta.width, meta.height, { kernel: "nearest" }).jpeg().toBuffer();
      await ctx.replyWithPhoto({ source: out });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

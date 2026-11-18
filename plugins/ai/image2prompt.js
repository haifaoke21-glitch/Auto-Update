import { callApiTry, findText, uploadTemp, NEXRAY, replyLong } from "../../src/lib/xapi.js";
import { getMediaBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["image2prompt"],
  category: "ai",
  description: "Buat prompt dari gambar. Balas/kirim foto dengan /image2prompt",
  cooldown: 10000,
  run: async (ctx) => {
    const buf = await getMediaBuffer(ctx, ["photo", "document"]);
    if (!buf) return ctx.reply("Contoh: balas/kirim sebuah foto dengan /image2prompt");
    ctx.sendChatAction("typing").catch(() => {});
    try {
      const link = await uploadTemp(buf);
      const r = await callApiTry(NEXRAY, "/ai/image2prompt", ["url", "image", "imageUrl", "link"].map((k) => ({ [k]: link })));
      const out = r.json ? findText(r.json) : r.text;
      await replyLong(ctx, out);
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat prompt: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

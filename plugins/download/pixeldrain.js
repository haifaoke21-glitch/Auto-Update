import { sendFromUrl } from "../../src/lib/send.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["pixeldrain"],
  category: "download",
  description: "Download file Pixeldrain. Contoh: /pixeldrain https://pixeldrain.com/u/xxxx",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    const m = text.match(/pixeldrain\.com\/u\/([A-Za-z0-9]+)/i);
    if (!m) return ctx.reply("Contoh: /pixeldrain https://pixeldrain.com/u/xxxx");
    try {
      await sendFromUrl(ctx, `https://pixeldrain.com/api/file/${m[1]}`, "document", { filename: m[1] });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

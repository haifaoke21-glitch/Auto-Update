import { getJson, isUrl, escH } from "../../src/lib/util.js";

export default {
  command: ["short", "shorturl", "tinyurl"],
  category: "utility",
  description: "Persingkat link. Contoh: /short https://contoh.com/panjang",
  run: async (ctx, { text }) => {
    if (!isUrl(text)) return ctx.reply("Contoh: /short https://contoh.com/halaman-panjang");
    try {
      const json = await getJson("https://is.gd/create.php", { format: "json", url: text });
      if (!json.shorturl) throw new Error(json.errormessage || "gagal");
      await ctx.reply(`<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> ${escH(json.shorturl)}`, { parse_mode: "HTML" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

import axios from "axios";
import * as cheerio from "cheerio";
import { sendFromUrl } from "../../src/lib/send.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["mediafire"],
  category: "download",
  description: "Download file MediaFire. Contoh: /mediafire https://www.mediafire.com/file/xxx",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    if (!/mediafire\.com/i.test(text)) return ctx.reply("Contoh: /mediafire https://www.mediafire.com/file/xxx");
    try {
      const { data: html } = await axios.get(text.trim(), { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 });
      const $ = cheerio.load(html);
      const link = $("a#downloadButton").attr("href");
      const name = $(".dl-btn-label").attr("title") || $(".filename").first().text().trim() || "mediafire-file";
      if (!link) throw new Error("Link unduhan tidak ditemukan (file dihapus / butuh password)");
      await sendFromUrl(ctx, link, "document", { parse_mode: "HTML", filename: name, caption: `<tg-emoji emoji-id="5431721976769027887">📁</tg-emoji> ${escH(name)}` });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

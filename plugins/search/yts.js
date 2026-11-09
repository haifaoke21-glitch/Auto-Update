import axios from "axios";
import { esc, escH } from "../../src/lib/util.js";

// Scraping halaman hasil pencarian YouTube (tanpa API key). Bisa berhenti bekerja jika YouTube mengubah format halaman.
export default {
  command: ["ytsearch"],
  category: "search",
  description: "Cari video YouTube. Contoh: /yts tutorial nodejs",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /yts tutorial nodejs");
    try {
      const { data: html } = await axios.get("https://www.youtube.com/results", {
        params: { search_query: text },
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "id-ID,id;q=0.9" },
        timeout: 20000,
      });
      const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
      if (!m) throw new Error("format halaman berubah");
      const data = JSON.parse(m[1]);
      const sections = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
      const items = sections.flatMap((s) => s.itemSectionRenderer?.contents || []).filter((x) => x.videoRenderer).slice(0, 5);
      if (!items.length) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Tidak ada hasil.", { parse_mode: "HTML" });
      const out = items
        .map((x) => {
          const v = x.videoRenderer;
          return `<tg-emoji emoji-id="5388724152930708079">🎬</tg-emoji> <b>${escH(v.title.runs[0].text)}</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${escH(v.ownerText?.runs?.[0]?.text || "-")} • ${escH(v.lengthText?.simpleText || "LIVE")}\nhttps://youtu.be/${escH(v.videoId)}`;
        })
        .join("\n\n");
      await ctx.replyWithHTML(out, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal mencari: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

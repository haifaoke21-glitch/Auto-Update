import { getJson, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["wikipedia"],
  category: "search",
  description: "Cari di Wikipedia Indonesia. Contoh: /wikipedia Candi Borobudur",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /wikipedia Candi Borobudur");
    try {
      const s = await getJson("https://id.wikipedia.org/w/api.php", {
        action: "opensearch", search: text, limit: 1, format: "json",
      });
      const title = s[1]?.[0];
      if (!title) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Artikel tidak ditemukan.", { parse_mode: "HTML" });
      const d = await getJson(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      const caption = `<tg-emoji emoji-id="5222444124698853913">📚</tg-emoji> <b>${escH(d.title)}</b>\n\n${escH((d.extract || "").slice(0, 800))}\n\n${escH(d.content_urls?.desktop?.page || "")}`;
      if (d.thumbnail?.source) {
        try { return await ctx.replyWithPhoto(d.thumbnail.source, { caption, parse_mode: "HTML" }); } catch {}
      }
      await ctx.replyWithHTML(caption);
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal mencari: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

import { getJson, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["ghsearch"],
  category: "search",
  description: "Cari repo GitHub. Contoh: /gh telegram bot nodejs",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /gh telegram bot nodejs");
    try {
      const j = await getJson("https://api.github.com/search/repositories", { q: text, per_page: 5, sort: "stars" });
      if (!j.items?.length) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Tidak ada hasil.", { parse_mode: "HTML" });
      const out = j.items
        .map((r) => `<tg-emoji emoji-id="6123129707614441341">⭐</tg-emoji> ${escH(r.stargazers_count)} • <b>${escH(r.full_name)}</b>\n${escH(r.description || "-")}\n${escH(r.html_url)}`)
        .join("\n\n");
      await ctx.replyWithHTML(out, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

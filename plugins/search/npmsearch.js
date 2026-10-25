import { getJson, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["npmsearch"],
  category: "search",
  description: "Cari package npm. Contoh: /npm telegraf",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /npm telegraf");
    try {
      const j = await getJson("https://registry.npmjs.org/-/v1/search", { text, size: 5 });
      if (!j.objects?.length) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Tidak ada hasil.", { parse_mode: "HTML" });
      const out = j.objects
        .map((o) => `<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> <b>${escH(o.package.name)}</b> v${escH(o.package.version)}\n${escH(o.package.description || "-")}\nnpmjs.com/package/${escH(o.package.name)}`)
        .join("\n\n");
      await ctx.replyWithHTML(out, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

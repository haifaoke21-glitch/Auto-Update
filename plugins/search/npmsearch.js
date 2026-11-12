import { getJson, escH } from "../../src/lib/util.js";

export default {
  command: ["npmsearch"],
  category: "search",
  description: "Cari package NPM. Contoh: /npmsearch telegraf",
  run: async (ctx, { text }) => {
    const query = String(text || "").trim();
    if (!query) return ctx.reply("Contoh: /npmsearch express");

    try {
      const apiUrl = "https://api-cloud.my.id/search/npm";
      const data = await getJson(apiUrl, { query, limit: 5 });
      if (!data?.status || !Array.isArray(data.result) || !data.result.length) {
        return ctx.reply("❌ Tidak ada hasil untuk pencarian tersebut.", { parse_mode: "HTML" });
      }

      const out = data.result
        .slice(0, 5)
        .map((pkg) => {
          const links = pkg.links || {};
          const npmLink = links.npm || `https://www.npmjs.com/package/${pkg.package}`;
          return (
            `📦 <b>${escH(pkg.package)}</b> v${escH(pkg.version || "?")}\n` +
            `${escH(pkg.description || "-")}\n` +
            `<a href="${escH(npmLink)}">npmjs.com</a>`
          );
        })
        .join("\n\n");

      const header = `🔍 Hasil pencarian NPM untuk "<b>${escH(query)}</b>" (${data.total || data.result.length} total)\n\n`;
      await ctx.replyWithHTML(header + out, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.reply(`❌ Gagal mencari package NPM: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

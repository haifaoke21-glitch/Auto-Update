import { settingsDb } from "../../src/database.js";
import { legacyMarkdownToHtml } from "../../src/lib/premiumEmoji.js";

const DEFAULT_RULES = `<tg-emoji emoji-id="5956561916573782596">📜</tg-emoji> <b>Aturan Grup</b>
1. Dilarang spam.
2. Dilarang kirim link grup lain, promosi, atau forward pesan (filter otomatis bila diaktifkan admin).
3. Dilarang SARA, pornografi, dan judi online.
4. Hormati sesama member dan admin.
5. Gunakan command dengan bijak.`;

export default {
  command: ["rules", "aturan"],
  category: "main",
  description: "Menampilkan aturan grup",
  run: async (ctx) => {
    const custom = settingsDb.data.settings?.rules;
    await ctx.replyWithHTML(custom ? legacyMarkdownToHtml(custom) : DEFAULT_RULES);
  },
};

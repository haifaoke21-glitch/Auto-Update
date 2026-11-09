import { sendFromUrl } from "../../src/lib/send.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["githubdl"],
  category: "download",
  description: "Download repo GitHub sebagai ZIP. Contoh: /gitclone https://github.com/user/repo",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    const m = text.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
    if (!m) return ctx.reply("Contoh: /gitclone https://github.com/user/repo");
    const user = m[1];
    const repo = m[2].replace(/\.git$/, "");
    try {
      await sendFromUrl(ctx, `https://api.github.com/repos/${user}/${repo}/zipball`, "document", {
        parse_mode: "HTML",
        filename: `${repo}.zip`,
        caption: `<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> ${escH(user)}/${escH(repo)}`,
      });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

import { saveUser } from "../../src/database.js";

export default {
  command: ["unreg"],
  category: "user",
  description: "Batalkan pendaftaran",
  run: async (ctx) => {
    await saveUser(ctx.from.id, { registered: false });
    await ctx.reply("<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> Pendaftaran kamu telah dibatalkan.", { parse_mode: "HTML" });
  },
};

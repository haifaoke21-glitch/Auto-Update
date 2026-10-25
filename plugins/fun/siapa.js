import { esc, displayName, escH } from "../../src/lib/util.js";

export default {
  command: ["siapa"],
  category: "fun",
  description: "Siapa di grup yang paling ...? (pakai admin grup sebagai pool). Contoh: /siapa paling rajin",
  groupOnly: true,
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /siapa yang paling rajin?");
    // Telegram tidak bisa list semua member; pakai daftar admin sebagai kandidat
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    const pool = admins.map((a) => a.user).filter((u) => !u.is_bot);
    const who = pool[Math.floor(Math.random() * pool.length)];
    await ctx.replyWithHTML(`🎯 <b>Siapa ${escH(text)}</b>\n\nJawabannya: ${escH(displayName(who))}`);
  },
};

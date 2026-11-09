import { getActive, clearGame } from "../../src/lib/games.js";
import { esc, escH } from "../../src/lib/util.js";

export default {
  command: ["nyerah"],
  category: "game",
  description: "Menyerah dari game yang sedang berjalan",
  run: async (ctx) => {
    const st = getActive(ctx.chat.id);
    if (!st || !st.answer) return ctx.reply("Tidak ada game yang sedang berjalan.");
    const reveal = Array.isArray(st.answer) ? st.answer.join(", ") : st.answer;
    clearGame(ctx.chat.id);
    await ctx.replyWithHTML(`🏳️ Menyerah. Jawabannya: <b>${escH(reveal)}</b>`);
  },
};

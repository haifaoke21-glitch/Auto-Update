import { resetMemory } from "../../src/lib/ai.js";

export default {
  command: ["resetai"],
  category: "ai",
  description: "Hapus memori percakapan AI kamu",
  run: async (ctx) => {
    resetMemory(`${ctx.chat.id}:${ctx.from.id}`);
    await ctx.reply("<tg-emoji emoji-id=\"6269118781331609137\">🧹</tg-emoji> Memori percakapan AI direset.", { parse_mode: "HTML" });
  },
};

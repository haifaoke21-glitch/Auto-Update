import { rand, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["rate"],
  category: "fun",
  description: "Beri rating 0-100 untuk apa saja. Contoh: /rate nasi goreng",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /rate nasi goreng buatanku");
    const r = rand(0, 100);
    await ctx.replyWithHTML(`<tg-emoji emoji-id="6123129707614441341">⭐</tg-emoji> <b>Rating</b>\n\n${escH(text)}\nSkor: <b>${escH(r)}/100</b>`);
  },
};

import { escH } from "../../src/lib/util.js";
export default {
  command: ["hitung"],
  category: "tools",
  description: "Kalkulator. Contoh: /hitung (12+8)*3/4",
  run: async (ctx, { text }) => {
    const expr = text.replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
    if (!expr) return ctx.reply("Contoh: /hitung (12+8)*3/4");
    // whitelist ketat: hanya angka, operator dasar, kurung, spasi
    if (!/^[0-9+\-*/%().\s]+$/.test(expr)) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Hanya angka dan operator + - * / % ^ ( ) yang diperbolehkan.", { parse_mode: "HTML" });
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      if (!Number.isFinite(result)) throw new Error("bukan angka");
      await ctx.reply(`<tg-emoji emoji-id="5402477260982731644">🧮</tg-emoji> ${escH(text)} = ${escH(result)}`, { parse_mode: "HTML" });
    } catch {
      await ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Ekspresi tidak valid.", { parse_mode: "HTML" });
    }
  },
};

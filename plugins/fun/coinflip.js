import { pick, rand, escH } from "../../src/lib/util.js";

export default {
  command: ["coin", "dadu"],
  category: "fun",
  description: "Lempar koin (/coin) atau dadu (/dadu)",
  run: async (ctx) => {
    const raw = (ctx.message.text || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    if (cmd === "dadu") return ctx.reply(`🎲 Hasil dadu: ${escH(rand(1, 6))}`, { parse_mode: "HTML" });
    return ctx.reply(`<tg-emoji emoji-id="6089104607328342288">🪙</tg-emoji> ${escH(pick(["Angka", "Gambar"]))}`, { parse_mode: "HTML" });
  },
};

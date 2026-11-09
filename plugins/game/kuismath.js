import { startGame, getActive } from "../../src/lib/games.js";
import { rand, pick, escH } from "../../src/lib/util.js";
import { fetchGameQuestion } from "../../src/lib/gameApi.js";

// Level bot -> level API (kalau API tidak mengenalinya, dicoba lagi tanpa level)
const LEVEL = { mudah: "easy", sedang: "medium", sulit: "hard" };

// Soal cadangan kalau API gagal
function localQuestion(level) {
  const max = { mudah: 20, sedang: 100, sulit: 500 }[level] || 20;
  const op = pick(["+", "-", "×"]);
  let a = rand(1, max), b = rand(1, op === "×" ? Math.min(max, 20) : max);
  if (op === "-" && b > a) [a, b] = [b, a];
  const answer = String(op === "+" ? a + b : op === "-" ? a - b : a * b);
  return { soal: `${a} ${op} ${b}`, jawaban: answer };
}

export default {
  command: ["math"],
  category: "game",
  description: "Kuis hitung cepat (tingkat: mudah/sedang/sulit)",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (getActive(ctx.chat.id)) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Masih ada game berjalan. /nyerah untuk berhenti.", { parse_mode: "HTML" });
    const level = (args[0] || "mudah").toLowerCase();

    const q =
      (await fetchGameQuestion("maths", { level: LEVEL[level] || "easy" })) ||
      (await fetchGameQuestion("maths")) ||
      localQuestion(level);

    startGame(ctx, { kind: "single", answer: q.jawaban }, 30000);
    const expr = /\?$|^berapa/i.test(q.soal) ? q.soal : `Berapa hasil ${q.soal}?`;
    await ctx.reply(`<tg-emoji emoji-id="5402477260982731644">🧮</tg-emoji> ${escH(expr)}\n<tg-emoji emoji-id="5969545478155539601">⏱</tg-emoji> 30 detik`, { parse_mode: "HTML" });
  },
};

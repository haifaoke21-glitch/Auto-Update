import { listGameData, loadQuestions, startGame, getActive } from "../../src/lib/games.js";
import { pick, esc, escH } from "../../src/lib/util.js";
import { API_GAMES, fetchGameQuestion } from "../../src/lib/gameApi.js";

// Semua file data/game/<nama>.json otomatis jadi command /<nama>
const names = listGameData();

const LABEL = {
  tebakkata: "Tebak Kata", asahotak: "Asah Otak", tekateki: "Teka-Teki", tebaktebakan: "Tebak-Tebakan",
  tebakhewan: "Tebak Hewan", tebakmakanan: "Tebak Makanan", tebaknegara: "Tebak Negara",
  tebakbendera: "Tebak Bendera", tebakkimia: "Tebak Kimia", tebakprofesi: "Tebak Profesi",
  family100: "Family 100", susunkata: "Susun Kata", kuismath: "Kuis Matematika",
};

function scramble(word) {
  const chars = word.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const out = chars.join("");
  return out === word && word.length > 2 ? scramble(word) : out;
}

export default {
  command: names,
  category: "game",
  description: "Game tebak-tebakan.",
  cooldown: 3000,
  run: async (ctx) => {
    const raw = (ctx.message.text || ctx.message.caption || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    if (!names.includes(cmd)) return;

    if (getActive(ctx.chat.id)) {
      return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Masih ada game yang berjalan di chat ini. Jawab soalnya, atau ketik /nyerah.", { parse_mode: "HTML" });
    }
    // Soal diambil dari API; kalau API gagal, pakai data lokal data/game/<nama>.json
    let q = API_GAMES.has(cmd) ? await fetchGameQuestion(cmd) : null;
    if (!q) {
      const questions = loadQuestions(cmd);
      if (!questions.length) return ctx.reply("Data soal kosong.");
      q = pick(questions);
    }
    const title = LABEL[cmd] || cmd.toUpperCase();

    // Family 100: jawaban berupa array
    if (Array.isArray(q.jawaban)) {
      startGame(ctx, { kind: "family", answer: q.jawaban, found: q.jawaban.map(() => 0) }, 90000);
      return ctx.replyWithHTML(
        `👨‍👩‍👧‍👦 <b>${escH(title)}</b>\n\n${escH(q.soal)}\n\nAda <b>${escH(q.jawaban.length)}</b> jawaban. Waktu 90 detik!`
      );
    }

    let question = q.soal || "";
    let answer = q.jawaban;
    if (cmd === "susunkata") {
      // dari API: q.soal = huruf teracak, q.hint = petunjuk. Dari data lokal: q.soal = petunjuk.
      const letters = q.hint !== undefined ? (q.soal || scramble(q.jawaban.toUpperCase())).toUpperCase() : scramble(q.jawaban.toUpperCase());
      const hint = q.hint !== undefined ? q.hint : q.soal;
      question = `Susun huruf berikut jadi kata:\n\n<b>${escH(letters)}</b>${hint ? `\n<i>Petunjuk: ${escH(hint)}</i>` : ""}`;
    } else {
      question = escH(question);
    }

    startGame(ctx, { kind: "single", answer }, 60000);
    const caption = `🎮 <b>${escH(title)}</b>\n\n${question}\n\n<tg-emoji emoji-id="5969545478155539601">⏱</tg-emoji> 60 detik • /nyerah untuk menyerah`;
    if (q.img) {
      try {
        return await ctx.replyWithPhoto(q.img, { caption, parse_mode: "HTML" });
      } catch {
        /* gambar gagal dimuat, kirim teks saja */
      }
    }
    return ctx.replyWithHTML(caption);
  },
};

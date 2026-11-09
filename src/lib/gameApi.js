import axios from "axios";

const BASE = "https://api.deline.web.id/game";

// Game yang soalnya diambil dari API (sisanya tetap dari data/game/*.json)
export const API_GAMES = new Set(["asahotak", "family100", "susunkata", "tebakbendera", "tekateki", "tebakkata", "tebakkimia"]);
// Kuis hitung (/math) memakai endpoint "maths" — ditangani di plugins/game/kuismath.js

const str = (v) => (v == null ? "" : String(v).trim());
const sortChars = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, "").split("").sort().join("");

/** Ubah respons API (bentuknya bisa beda-beda) jadi { soal, jawaban, img, hint } atau null */
export function normalizeGame(name, json) {
  let d = json?.result ?? json?.data ?? json;
  if (Array.isArray(d)) d = d[Math.floor(Math.random() * d.length)];
  if (!d || typeof d !== "object") return null;

  let soal = str(d.soal ?? d.question ?? d.pertanyaan ?? d.clue ?? d.string ?? d.expression ?? d.ekspresi);
  let jawaban = d.jawaban ?? d.answer ?? d.jawab ?? d.answers ?? d.number ?? d.hasil ?? d.name ?? d.nama ?? d.negara;

  if (name === "tebakkimia" && !soal && (d.lambang || d.symbol)) {
    // format {unsur, lambang} -> pertanyaan dibuat sendiri
    soal = `Apa nama unsur dengan lambang ${str(d.lambang ?? d.symbol)}?`;
    jawaban = d.unsur ?? d.element ?? jawaban;
  }

  if (name === "maths") {
    jawaban = Array.isArray(jawaban) ? jawaban[0] : jawaban;
    if (!soal || jawaban == null || str(jawaban) === "") return null;
    return { soal: soal.replace(/\*/g, "×").replace(/\//g, "÷"), jawaban: str(jawaban) };
  }
  const img = str(d.img ?? d.image ?? d.gambar ?? d.url ?? d.flag_url);

  if (name === "family100") {
    if (typeof jawaban === "string") jawaban = jawaban.split(/[,\n;]+/);
    if (!Array.isArray(jawaban)) return null;
    jawaban = jawaban
      .map((a) => (typeof a === "object" && a ? str(a.jawaban ?? a.answer ?? a.name) : str(a)))
      .filter(Boolean);
    if (!soal || !jawaban.length) return null;
    return { soal, jawaban };
  }

  jawaban = Array.isArray(jawaban) ? str(jawaban[0]) : str(jawaban);
  if (!jawaban) return null;

  if (name === "tebakbendera") {
    if (!img && !soal) return null;
    return { soal: soal || "Bendera negara apa ini?", jawaban, img: /^https?:\/\//i.test(img) ? img : "" };
  }

  if (name === "susunkata") {
    // API biasanya sudah memberi huruf teracak di "soal" dan petunjuk di "tipe"
    const scrambled = soal && sortChars(soal) === sortChars(jawaban) ? soal : "";
    return { soal: scrambled, jawaban, hint: str(d.tipe ?? d.type ?? d.hint ?? (scrambled ? "" : soal)) };
  }

  if (!soal) return null;
  return { soal, jawaban };
}

/** Ambil 1 soal dari API. Return null kalau gagal supaya pemanggil bisa pakai data lokal. */
export async function fetchGameQuestion(name, params) {
  try {
    const res = await axios.get(`${BASE}/${name}`, {
      params,
      timeout: 12000,
      headers: { "User-Agent": "Mozilla/5.0" },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return normalizeGame(name, res.data);
  } catch {
    return null;
  }
}

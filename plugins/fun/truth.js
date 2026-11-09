import { pick, escH } from "../../src/lib/util.js";

const truths = [
  "Apa hal paling memalukan yang pernah kamu alami?",
  "Siapa orang terakhir yang kamu stalk di sosmed?",
  "Apa kebohongan terbesar yang pernah kamu ucapkan?",
  "Apa kebiasaan anehmu yang jarang orang tahu?",
  "Kalau bisa ulang waktu, keputusan apa yang mau kamu ubah?",
  "Apa hal yang paling kamu takutkan?",
  "Lagu apa yang malu kamu akui kamu suka?",
  "Apa cita-cita masa kecilmu yang belum tercapai?",
];

export default {
  command: ["truth"],
  category: "fun",
  description: "Pertanyaan truth acak",
  run: (ctx) => ctx.replyWithHTML(`🫢 <b>TRUTH</b>\n${escH(pick(truths))}`),
};

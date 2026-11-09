import { pick, escH } from "../../src/lib/util.js";

const dares = [
  "Kirim voice note nyanyi 10 detik ke grup.",
  "Ganti foto profil jadi meme selama 1 jam.",
  "Ceritakan lelucon paling garing yang kamu tahu.",
  "Kirim selfie dengan ekspresi paling jelek.",
  "Tulis pantun untuk admin grup.",
  "Ketik pesan berikutnya hanya pakai emoji.",
  "Puji tiga orang di grup ini dengan tulus.",
  "Ceritakan mimpi teraneh yang pernah kamu alami.",
];

export default {
  command: ["dare"],
  category: "fun",
  description: "Tantangan dare acak",
  run: (ctx) => ctx.replyWithHTML(`<tg-emoji emoji-id="5390902693487223784">😈</tg-emoji> <b>DARE</b>\n${escH(pick(dares))}`),
};

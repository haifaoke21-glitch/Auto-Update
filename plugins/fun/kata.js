import { pick } from "../../src/lib/util.js";

const BANK = {
  bucin: [
    "Kamu itu kayak WiFi, tanpa kamu hidupku nggak ada sinyal.",
    "Aku bukan orang hebat, tapi aku bakal berusaha jadi yang terbaik buat kamu.",
    "Kalau kamu jadi kenangan, aku rela ingatan ini nggak pernah hilang.",
    "Capek ya? Sini, sandaran dulu sama aku.",
    "Kamu tahu bedanya kamu sama kopi? Kopi bikin melek, kamu bikin melting.",
  ],
  renungan: [
    "Tidak semua yang tertunda itu ditolak. Kadang semesta sedang menyiapkan yang lebih pas.",
    "Berhenti membandingkan; setiap orang punya musim mekarnya masing-masing.",
    "Yang tenang bukan berarti kosong, kadang ia sedang belajar bertahan.",
    "Hari yang berat akan lewat. Kamu sudah selamat dari semua hari buruk sebelumnya.",
    "Pelan-pelan saja, yang penting tidak berhenti.",
  ],
  puisi: [
    "Senja menutup hari dengan tenang,\nseperti rindu yang tak butuh ditimbang.\nDi antara langit jingga dan angin petang,\nkuselipkan namamu dalam tiap sembahyang.",
    "Hujan turun tanpa permisi,\nmembawa cerita yang pernah kusimpan sendiri.\nDan di setiap tetesnya kuberi arti:\nada yang pergi, ada yang tetap di hati.",
    "Malam adalah buku yang sunyi,\ntempat bintang menulis tanpa henti.\nAku membacanya pelan-pelan sekali,\nmencari namamu di antara mimpi.",
  ],
  senja: [
    "Senja itu bukan tentang perpisahan, tapi tentang keindahan yang berani pamit dengan tenang. 🌇",
    "Langit sore selalu tahu cara menenangkan hati yang lelah. 🌅",
    "Ada yang lebih indah dari senja: bisa menikmatinya bersama orang yang tepat. 🧡",
  ],
};

export default {
  command: Object.keys(BANK),
  category: "fun",
  description: "Kata-kata acak: bucin / renungan / puisi / senja",
  run: async (ctx) => {
    const raw = (ctx.message.text || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    const list = BANK[cmd];
    if (!list) return;
    await ctx.reply(pick(list));
  },
};

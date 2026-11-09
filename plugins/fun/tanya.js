import { pick, rand, esc, displayName, escH } from "../../src/lib/util.js";

const yn = ["Iya, pasti", "Tidak", "Mungkin saja", "Kayaknya sih iya", "Kayaknya nggak deh", "100% iya", "Jangan berharap 😅", "Tanya lagi nanti ya"];
const waktu = ["Besok", "Lusa", "Minggu depan", "Bulan depan", "Tahun depan", "Sebentar lagi", "Nunggu kiamat dulu", "Hari ini juga", "Nggak akan pernah"];
const tempat = ["di rumah", "di kantor", "di warung kopi", "di Mars", "di bawah kasur", "di dalam hati kamu", "di Jakarta", "di pinggir jalan", "di mimpi"];
const cara = ["Pelan-pelan saja", "Coba tanya Google dulu", "Dengan penuh keyakinan", "Sambil ngopi", "Pakai doa dan usaha", "Ikuti kata hati"];
const sebab = ["Karena takdir", "Karena kurang tidur", "Karena begitu adanya", "Karena kamu belum siap", "Karena semesta berkata begitu", "Karena efek gabut"];

const TYPES = {
  apakah: { q: "Apakah", a: () => pick(yn) },
  bisakah: { q: "Bisakah", a: () => pick(yn) },
  haruskah: { q: "Haruskah", a: () => pick(yn) },
  akankah: { q: "Akankah", a: () => pick(yn) },
  kapan: { q: "Kapan", a: () => pick(waktu) },
  dimana: { q: "Dimana", a: () => pick(tempat) },
  bagaimana: { q: "Bagaimana", a: () => pick(cara) },
  mengapa: { q: "Mengapa", a: () => pick(sebab) },
  berapa: { q: "Berapa", a: () => `${rand(1, 100)}` },
};

export default {
  command: Object.keys(TYPES),
  category: "fun",
  description: "Tanya bot: apakah/kapan/dimana/berapa/dll. Contoh: /apakah aku ganteng",
  run: async (ctx, { text }) => {
    const raw = (ctx.message.text || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    const t = TYPES[cmd];
    if (!t) return;
    if (!text) return ctx.reply(`Contoh: /${cmd} aku bakal kaya`);
    await ctx.replyWithHTML(`<tg-emoji emoji-id="6269561132898325478">❓</tg-emoji> <b>${escH(t.q)}</b> ${escH(text)}\n\n<tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> ${escH(t.a())}`);
  },
};

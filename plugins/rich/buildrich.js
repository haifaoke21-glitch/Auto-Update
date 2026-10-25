import { parseRichMarkup } from "../../src/lib/richBuild.js";
import { expandAliases } from "../../src/lib/richEmojiPool.js";
import { entitiesToMarkers } from "../../src/lib/richEmoji.js";
import { sendRichBlocks } from "../../src/lib/richSend.js";
import { h } from "../../src/lib/rich.js";
import config from "../../config.js";

const usage = (p) =>
  `<tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> <b>Cara pakai ${h(p)}buildrich</b>\n\n` +
  `<pre>${h(p)}buildrich H(Judul)\n` +
  `D\n` +
  `T(judul tabel)\n` +
  `(kolom 1)(kolom 2)\n` +
  `(isi 1)(isi 2)\n\n` +
  `EX(judul lipat)\n` +
  `isi yang disembunyikan\n\n` +
  `L(item pertama)\n` +
  `(item kedua)\n\n` +
  `C(tugas belum selesai)\n` +
  `CC(tugas selesai)\n\n` +
  `BQ(kutipan)\n` +
  `BS(Join,https://t.me/abc)BD(Tutup,https://t.me/def)\n` +
  `BP(Web,https://example.com)\n\n` +
  `teks biasa = paragraf\n` +
  `F(catatan kecil di bawah)</pre>\n\n` +
  `<b>H(teks)</b> heading • <b>D</b> garis pemisah\n` +
  `<b>T(teks)</b> tabel: baris ini header, baris <code>(sel)(sel)</code> di bawahnya jadi isi\n` +
  `<b>EX(teks)</b> expandable: isinya baris di bawahnya sampai baris kosong\n` +
  `<b>L(teks)</b> list • <b>C(teks)</b> checkbox kosong • <b>CC(teks)</b> checkbox tercentang\n` +
  `<b>F(teks)</b> footer • <b>BQ/CD/P</b> kutipan / code / monospace\n` +
  `<b>B(teks,link)</b> tombol link: <code>B</code> biasa, <code>BP</code> biru, <code>BS</code> hijau, <code>BD</code> merah. Beberapa tombol sebaris: <code>BS(a,link)BD(b,link)</code>\n` +
  `Link boleh <code>https://...</code>, <code>t.me/...</code>, atau <code>@username</code>.\n` +
  `Kode emoji premium <code>{E1}</code>..<code>{E99}</code> atau emoji premium yang diketik langsung ikut terbaca.\n\n` +
  `<tg-emoji emoji-id="6120946172010959542">📷</tg-emoji> Mau ada foto di atasnya? <b>Balas fotonya</b> dengan perintah ini (atau kirim foto dengan caption perintah ini).`;

export default {
  command: ["buildrich"],
  category: "rich",
  description: "Bikin Rich Message dari markup singkat H/D/T/EX/L/C/F/B (balas foto = tambah foto). Contoh: /buildrich H(Judul)",
  cooldown: 3000,
  run: async (ctx) => {
    const msg = ctx.message;
    // Pakai teks mentah (bukan `text` dari handler) supaya baris baru tetap utuh
    const full = entitiesToMarkers(msg.text ?? msg.caption ?? "", msg.entities ?? msg.caption_entities);
    const raw = full.replace(/^\s*\S+\s*/, "").trim(); // buang token perintah di depan
    if (!raw) return ctx.reply(usage(config.prefix), { parse_mode: "HTML" });

    const parsed = parseRichMarkup(expandAliases(raw));
    if (parsed.error) {
      return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Format salah: ${h(parsed.error)}\n\nKetik <code>${h(config.prefix)}buildrich</code> tanpa isi untuk melihat contoh format.`, { parse_mode: "HTML" });
    }

    // Foto opsional: foto di pesan sendiri (caption) atau pesan yang dibalas (harus foto)
    let photoId = msg.photo?.at(-1)?.file_id || null;
    const reply = msg.reply_to_message;
    if (!photoId && reply) {
      photoId = reply.photo?.at(-1)?.file_id || null;
      if (!photoId) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Pesan yang kamu balas bukan foto. Balas sebuah <b>foto</b>, atau jangan balas apa-apa kalau tidak mau ada foto.", { parse_mode: "HTML" });
    }

    try {
      await sendRichBlocks(ctx, parsed.blocks, photoId);
    } catch (err) {
      console.error("[BUILDRICH]", err);
      await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal membuat Rich Message.\n\n<code>${h(err.message)}</code>`, { parse_mode: "HTML" }).catch(() => {});
    }
  },
};

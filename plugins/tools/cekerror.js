// plugins/tools/cekerror.js
// Cek syntax error pada kode / file JavaScript (CommonJS maupun ES Module).
// Kode tidak dijalankan, jadi aman. Hanya mendeteksi error SYNTAX, bukan error saat runtime.

import { checkSyntax, readCodeFromCtx } from "../../src/lib/jsSyntax.js";
import { escH } from "../../src/lib/util.js";

const OK = `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>`;
const NO = `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>`;
const WARN = `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>`;
const html = { parse_mode: "HTML" };

export default {
  command: ["cekerror"],
  category: "tools",
  description: "Cek syntax error kode/file JS. Reply file .js atau teks kode, lalu /cekerror",
  cost: 0, // gratis: pengecekan dilakukan lokal tanpa AI
  cooldown: 4000,
  run: async (ctx) => {
    let input;
    try {
      input = await readCodeFromCtx(ctx);
    } catch (err) {
      return ctx.reply(`${NO} Gagal membaca file: ${escH(err.message)}`, html);
    }
    if (!input) {
      return ctx.reply(
        `${WARN} <b>Cara pakai /cekerror</b>\n\nReply file <code>.js</code> atau pesan teks berisi kode, lalu kirim <code>/cekerror</code>.\nBisa juga kirim file dengan caption <code>/cekerror</code>.`,
        html
      );
    }
    if (input.error) return ctx.reply(`${NO} ${escH(input.error)}`, html);

    const { code, fileName } = input;
    let res;
    try {
      res = await checkSyntax(code);
    } catch (err) {
      return ctx.reply(`${NO} Gagal mengecek: ${escH(err.message)}`, html);
    }

    const lines = code.split(/\r?\n/).length;
    const info = `File: <code>${escH(fileName)}</code>\nTipe: ${res.module === "ESM" ? "ES Module (import/export)" : "CommonJS (require)"}\nBaris: ${lines} | Ukuran: ${code.length} karakter`;

    if (res.valid) {
      return ctx.reply(`${OK} <b>Syntax valid</b>\nTidak ada error syntax.\n\n${info}`, html);
    }

    const e = res.error;
    const snippet = e.snippet ? `\n<pre>${escH(e.snippet.slice(0, 200))}</pre>` : "";
    return ctx.reply(
      `${NO} <b>Syntax error ditemukan</b>\n\n${info}\n\nBaris error: <b>${e.line ?? "?"}</b>${snippet}\n<blockquote>${escH(e.message)}</blockquote>\n💡 ${escH(e.hint)}\n\nGunakan /fixerror untuk memperbaiki otomatis (AI).`,
      html
    );
  },
};

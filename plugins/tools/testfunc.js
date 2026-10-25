// plugins/add/testfunc.js
// Jalankan function WA kustom ke target lewat sender yang aktif.
// Akses: Semua user (terdaftar).

import vm from "vm";
import { createRequire } from "module";
import {
  generateWAMessageFromContent,
  generateForwardMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  proto,
  jidDecode,
  areJidsSameUser,
} from "@whiskeysockets/baileys";
import { resolveSender } from "../../src/lib/whatsappSender.js";
import { isOwner } from "../../src/middleware.js";
import { sendRich, editRich, h, richTable } from "../../src/lib/rich.js";
import { getBuffer } from "../../src/lib/util.js";

// require tersedia di sandbox (pakai createRequire agar kompatibel ES Module)
const _require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTFUNC_COOLDOWN_MS = 10_000; // 10 detik cooldown per-user
const lastTestfunc = new Map();       // userId -> timestamp

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mono = (v) => `<code>${h(v)}</code>`;
const pre  = (v) => `<pre>${h(v)}</pre>`;
const bold = (v) => `<b>${h(v)}</b>`;

/** Bungkus sock dalam Proxy agar tidak bisa di-override dari sandbox */
function createSafeSock(sock) {
  return new Proxy(sock, { get: (t, p) => t[p] });
}

// ─── Syntax Checker ───────────────────────────────────────────────────────────
function checkSyntax(code) {
  const errors = [];
  try {
    new Function(code);
  } catch (e) {
    const raw = e.message;
    let line = null;
    const lineMatch = raw.match(/line\s+(\d+)/i) || raw.match(/:(\d+)$/);
    if (lineMatch) line = parseInt(lineMatch[1]);

    const lines   = code.split("\n");
    const snippet = line && lines[line - 1] ? lines[line - 1].trim() : null;
    let detail    = raw;
    let saran     = "Cek baris yang disebutkan dan pastikan semua bracket, tanda kutip, dan sintaks sudah benar.";

    if      (raw.includes("Unexpected token '}'"))        { detail = "Ada kurung kurawal `}` yang tidak punya pasangan pembuka `{`."; saran = "Cek blok function, if, for, atau object — ada yang kebuka tapi ga ditutup, atau malah kelebihan `}`."; }
    else if (raw.includes("Unexpected token '{'"))        { detail = "Ada kurung kurawal `{` di tempat yang tidak terduga."; saran = "Kemungkinan ada titik koma `;` yang kurang, atau blok sebelumnya belum ditutup dengan benar."; }
    else if (raw.includes("Unexpected token ')'"))        { detail = "Ada tanda kurung tutup `)` yang tidak punya pasangan `(`."; saran = "Cek pemanggilan function atau kondisi if — mungkin ada `)` berlebih atau `(` yang kurang."; }
    else if (raw.includes("Unexpected token '('"))        { detail = "Ada tanda kurung buka `(` di posisi yang tidak diharapkan."; saran = "Cek apakah ada operator atau keyword yang hilang sebelum `(` ini."; }
    else if (raw.includes("Unexpected end of input"))     { detail = "Kode tiba-tiba habis sebelum selesai — ada blok yang belum ditutup."; saran = "Pastikan semua `{`, `(`, `[`, dan string/template literal sudah ditutup dengan pasangannya."; }
    else if (raw.includes("Unexpected token ']'"))        { detail = "Ada tanda kurung siku tutup `]` yang berlebih atau salah posisi."; saran = "Cek array atau destructuring — mungkin ada `]` yang tidak punya pasangan `[`."; }
    else if (raw.includes("Unexpected token '['"))        { detail = "Ada tanda kurung siku `[` di tempat yang tidak terduga."; saran = "Pastikan penulisan array atau property access sudah benar."; }
    else if (raw.includes("Invalid or unexpected token")) { detail = "Ada karakter atau token yang tidak valid di kode kamu."; saran = "Cek apakah ada karakter aneh, tanda kutip yang tidak tertutup, atau simbol yang salah."; }
    else if (raw.includes("Unexpected identifier"))       { detail = "Ada identifier (nama variabel/fungsi) yang muncul di tempat yang tidak terduga."; saran = "Kemungkinan titik koma `;` atau koma `,` yang kurang di baris sebelumnya."; }
    else if (raw.includes("Unexpected string"))           { detail = "Ada string yang muncul di tempat yang tidak diharapkan."; saran = "Cek apakah ada operator atau tanda pisah yang kurang sebelum string ini."; }
    else if (raw.includes("Unexpected number"))           { detail = "Ada angka yang muncul di tempat yang tidak diharapkan."; saran = "Cek penulisan ekspresi atau assignment — mungkin ada operator yang hilang."; }
    else if (raw.includes("Missing initializer in const"))  { detail = "Variabel `const` dideklarasikan tanpa nilai awal."; saran = "Ganti ke `let` kalau mau assign nanti, atau langsung kasih nilai: `const x = ...`"; }
    else if (raw.includes("Cannot use import statement"))   { detail = "Kamu pakai `import` tapi environment ini pakai CommonJS (require)."; saran = "Ganti `import x from 'y'` menjadi `const x = require('y')`."; }
    else if (raw.includes("await is only valid"))           { detail = "`await` dipakai di luar function `async`."; saran = "Bungkus kode yang pakai `await` di dalam `async function`."; }
    else if (raw.includes("'return' outside") || raw.includes("Illegal return")) { detail = "`return` dipakai di luar function."; saran = "Pastikan `return` ada di dalam body sebuah function."; }
    else if (raw.includes("Duplicate parameter"))           { detail = "Ada nama parameter yang sama lebih dari sekali di function."; saran = "Ganti salah satu nama parameter supaya tidak ada duplikat."; }
    else if (raw.includes("Unterminated string"))           { detail = "Ada string yang tidak ditutup dengan tanda kutip."; saran = "Cek apakah semua `'`, `\"`, atau backtick `` ` `` sudah punya pasangan penutup."; }

    errors.push({ message: detail, line, snippet, saran, raw });
  }
  return errors;
}

// ─── Views (Rich + Legacy) ────────────────────────────────────────────────────
const views = {
  noSender: () => ({
    rich: `<div><h2>❌ Tidak Ada Sender Aktif</h2><blockquote>Belum ada sender WhatsApp yang terhubung.\nGunakan /addsender 628xxx untuk menambah sender.</blockquote></div>`,
    legacy: `<b><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Tidak Ada Sender Aktif</b>\n\nBelum ada sender yang terhubung.\nGunakan /addsender 628xxx untuk menambah.`,
  }),

  usage: () => ({
    rich: `<div><h2>📖 Cara Pakai /testfunc</h2><blockquote>Reply sebuah pesan yang berisi teks function atau file <code>.js</code>, lalu kirim perintah ini.</blockquote><pre>/testfunc 628xxx 10</pre><p>${bold("Parameter:")}<br/>• ${mono("628xxx")} — nomor target WhatsApp<br/>• ${mono("10")} — jumlah eksekusi (maks 1000)</p></div>`,
    legacy: `<b><tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Cara Pakai /testfunc</b>\n\nReply teks function atau file .js, lalu:\n/testfunc 628xxx 10\n\nParameter:\n• 628xxx  — nomor target WA\n• 10      — jumlah eksekusi (maks 1000)`,
  }),

  cooldown: (secs) => ({
    rich: `<div><h2>⏳ Tunggu Sebentar</h2><blockquote>Tunggu ${bold(String(secs))} detik sebelum menggunakan /testfunc lagi.</blockquote></div>`,
    legacy: `<b><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Tunggu Sebentar</b>\n\nTunggu ${secs} detik lagi.`,
  }),

  invalidCount: () => ({
    rich: `<div><h2>❌ Jumlah Tidak Valid</h2><blockquote>Jumlah harus berupa angka lebih dari 0.</blockquote></div>`,
    legacy: `❌ Jumlah harus angka yang valid dan lebih dari 0.`,
  }),

  noReply: () => ({
    rich: `<div><h2>❌ Tidak Ada Reply</h2><blockquote>Reply pesan yang berisi teks function atau file <code>.js</code> terlebih dahulu, baru kirim perintah ini.</blockquote></div>`,
    legacy: `❌ Reply dengan teks function atau file .js dulu, baru kirim perintah ini.`,
  }),

  invalidFile: () => ({
    rich: `<div><h2>❌ File Tidak Valid</h2><blockquote>File yang di-reply harus berekstensi <code>.js</code></blockquote></div>`,
    legacy: `❌ File harus berekstensi .js !`,
  }),

  invalidFunc: () => ({
    rich: `<div><h2>❌ Function Tidak Valid</h2><blockquote>Function tidak ditemukan. Pastikan kode mengandung ${mono("async function namaFunc")}.</blockquote></div>`,
    legacy: `❌ Function tidak valid.\nPastikan ada 'async function namaFunc' di dalam kode.`,
  }),

  process: (target, phone, id) => {
    const tbl = richTable(["Field", "Value"], [
      ["Target",  h(target)],
      ["Sender",  h(phone || id)],
      ["Status",  "⏳ Proses..."],
    ]);
    return {
      rich: `<div><h2>⚡ TestFunc Running</h2>${tbl}</div>`,
      legacy: `<b><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> TestFunc Running</b>\n\n↯ Target : ${target}\n↯ Sender : ${phone || id}\n↯ Status : Proses...`,
    };
  },

  done: (target, phone, id, count) => {
    const tbl = richTable(["Field", "Value"], [
      ["Target",  h(target)],
      ["Sender",  h(phone || id)],
      ["Jumlah",  h(String(count))],
      ["Status",  "✅ Selesai"],
    ]);
    return {
      rich: `<div><h2>✅ TestFunc Selesai</h2>${tbl}</div>`,
      legacy: `<b><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> TestFunc Selesai</b>\n\n↯ Target : ${target}\n↯ Sender : ${phone || id}\n↯ Jumlah : ${count}\n↯ Status : <tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Selesai`,
    };
  },

  syntaxError: (err) => {
    const tbl = richTable(["Field", "Value"], [
      ["Baris",  h(String(err.line || "-"))],
      ["Status", "❌ Syntax Error"],
    ]);
    const body =
      tbl +
      `<details><summary>🔍 Kode Bermasalah</summary>${pre(err.snippet || "-")}</details>` +
      `<details><summary>📌 Penjelasan</summary><p>${h(err.message)}</p></details>` +
      `<details><summary>💡 Saran</summary><p>${h(err.saran)}</p></details>` +
      `<details><summary>🪲 Raw Error</summary>${pre(err.raw)}</details>`;
    return {
      rich: `<div><h2>❌ Syntax Error</h2>${body}</div>`,
      legacy: `<b><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Syntax Error</b>\n\nBaris  : ${err.line || "-"}\nKode   : ${err.snippet || "-"}\n\n<tg-emoji emoji-id="5397782960512444700">📌</tg-emoji> ${err.message}\n💡 ${err.saran}`,
    };
  },

  error: (msg) => ({
    rich: `<div><h2>❌ Terjadi Kesalahan</h2>${pre(msg)}</div>`,
    legacy: `❌ Terjadi kesalahan:\n${msg}`,
  }),
};

// ─── Plugin ───────────────────────────────────────────────────────────────────
export default {
  command: ["testfunc"],
  category: "tools",
  description: "Jalankan function WA kustom ke target (reply function atau file .js)",
  ownerOnly: false,
  privateOnly: false,
  cost: 0,
  cooldown: 3000,
  loading: false,

  run: async (ctx, { args }) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // ── Cek args minimal ─────────────────────────────────────────────────────
    if (args.length < 2) {
      return sendRich(ctx.telegram, chatId, views.usage());
    }

    // ── Sender milik user (owner: sender pilihan lewat /pilihsender) ─────────
    const connectedSender = resolveSender(userId, isOwner(userId));
    if (!connectedSender) {
      return sendRich(ctx.telegram, chatId, views.noSender());
    }
    const sock = connectedSender.sock;

    // ── Cooldown per-user ────────────────────────────────────────────────────
    const now       = Date.now();
    const remaining = TESTFUNC_COOLDOWN_MS - (now - (lastTestfunc.get(userId) || 0));
    if (remaining > 0) {
      return sendRich(ctx.telegram, chatId, views.cooldown(Math.ceil(remaining / 1000)));
    }

    // ── Parse argumen ────────────────────────────────────────────────────────
    const q      = args[0];
    const jumlah = Math.max(1, Math.min(parseInt(args[1]) || 1, 1000));
    if (!jumlah || jumlah <= 0) {
      return sendRich(ctx.telegram, chatId, views.invalidCount());
    }
    const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    // ── Cek ada reply ────────────────────────────────────────────────────────
    const replyMessage = ctx.message.reply_to_message;
    if (!replyMessage) {
      return sendRich(ctx.telegram, chatId, views.noReply());
    }

    // ── Ambil kode function dari reply ───────────────────────────────────────
    let funcCode = "";

    if (replyMessage.document) {
      const fileName = replyMessage.document.file_name || "";
      if (!fileName.endsWith(".js")) {
        return sendRich(ctx.telegram, chatId, views.invalidFile());
      }
      try {
        const fileLink = await ctx.telegram.getFileLink(replyMessage.document.file_id);
        const buf      = await getBuffer(fileLink.href);
        funcCode       = buf.toString("utf-8");
      } catch (err) {
        console.error("[TESTFUNC] Download error:", err.message);
        return sendRich(ctx.telegram, chatId, views.error("Gagal membaca file .js: " + (err.message || err)));
      }
    } else if (replyMessage.text) {
      funcCode = replyMessage.text;
    } else {
      return sendRich(ctx.telegram, chatId, views.noReply());
    }

    // ── Cek syntax SEBELUM dijalankan ────────────────────────────────────────
    const syntaxErrors = checkSyntax(funcCode);
    if (syntaxErrors.length > 0) {
      return sendRich(ctx.telegram, chatId, views.syntaxError(syntaxErrors[0]));
    }

    // ── Validasi nama function ───────────────────────────────────────────────
    const funcMatch = funcCode.match(/async function\s+(\w+)/);
    if (!funcMatch) {
      return sendRich(ctx.telegram, chatId, views.invalidFunc());
    }
    const funcName = funcMatch[1];

    // ── Set cooldown ─────────────────────────────────────────────────────────
    lastTestfunc.set(userId, Date.now());

    // ── Kirim status "proses" ─────────────────────────────────────────────────
    let processMsg = null;
    try {
      processMsg = await sendRich(
        ctx.telegram, chatId,
        views.process(q, connectedSender.phone, connectedSender.id)
      );
    } catch { /* lanjut meski gagal kirim status */ }

    // ── Jalankan function di dalam VM sandbox ─────────────────────────────────
    try {
      const safeSock = createSafeSock(sock);

      const sandbox = {
        // Standard
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        Promise,

        // WA util
        sock: safeSock,
        target,
        sleep,

        // Baileys helpers (biarkan function pengguna mengakses langsung)
        generateWAMessageFromContent,
        generateForwardMessageContent,
        generateWAMessage,
        prepareWAMessageMedia,
        proto,
        jidDecode,
        areJidsSameUser,

        // CommonJS compat (butuh untuk beberapa func WA lama)
        require: _require,
        module: {},
      };

      const context = vm.createContext(sandbox);
      const fn      = vm.runInContext(`${funcCode}\n${funcName}`, context);

      for (let i = 0; i < jumlah; i++) {
        try {
          const arity = fn.length;
          if      (arity === 1) await fn(target);
          else if (arity === 2) await fn(safeSock, target);
          else                  await fn(safeSock, target, true);
        } catch (err) {
          console.error(`[TESTFUNC] Iterasi ${i + 1} error:`, err.message);
        }
        await sleep(200);
      }

      // ── Update status ke "selesai" ────────────────────────────────────────
      const doneView = views.done(q, connectedSender.phone, connectedSender.id, jumlah);
      if (processMsg?.message_id) {
        await editRich(ctx.telegram, chatId, processMsg.message_id, doneView).catch(() =>
          sendRich(ctx.telegram, chatId, doneView)
        );
      } else {
        await sendRich(ctx.telegram, chatId, doneView);
      }
    } catch (err) {
      console.error("[TESTFUNC] Main Error:", err);
      await sendRich(ctx.telegram, chatId, views.error(err.message || String(err)));
    }
  },
};

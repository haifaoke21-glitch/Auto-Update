// src/lib/jsSyntax.js
// Helper bersama untuk /cekerror dan /fixerror:
//  - checkSyntax(code)      : cek syntax JS (CommonJS / ES Module) TANPA menjalankan kodenya
//  - readCodeFromCtx(ctx)   : ambil kode dari reply (teks / file), file yang dikirim bersama command, atau teks setelah command

import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import vm from "vm";
import { getBuffer } from "./util.js";

export const MAX_CODE_BYTES = 200 * 1024; // batas ukuran file yang boleh dibaca

// Deteksi sintaks ES Module (import / export di awal baris)
const ESM_RE = /^\s*(?:import\s*[\w{*"']|export\s+(?:default|const|let|var|function|class|async|\{|\*))|\bimport\.meta\b/m;
// Pesan error CommonJS yang menandakan sebenarnya kodenya ES Module
const NEEDS_ESM_RE = /import statement|Unexpected token 'export'|import\.meta|await is only valid|Unexpected reserved word/i;

const HINTS = [
  [/Unexpected end of input/i, "Kode berakhir sebelum selesai: ada { ( [ atau string/template yang belum ditutup."],
  [/missing \) after argument list/i, "Ada kurung tutup ) atau koma yang kurang di pemanggilan function."],
  [/Unexpected token '\}'/i, "Ada } berlebih, atau blok sebelumnya salah tutup."],
  [/Unexpected token '\)'/i, "Ada ) berlebih atau ( yang kurang."],
  [/Unexpected token '\]'/i, "Ada ] berlebih atau [ yang kurang."],
  [/Unexpected token '\{'/i, "Ada { di tempat tak terduga; biasanya ) atau ; di baris sebelumnya kurang."],
  [/Unexpected identifier/i, "Ada nama variabel/function di tempat tak terduga; biasanya koma, titik koma, atau operator di baris sebelumnya kurang."],
  [/Invalid or unexpected token|Unterminated string|Unterminated template/i, "Ada tanda kutip/backtick yang tidak tertutup, atau karakter aneh di kode."],
  [/Missing initializer in const/i, "const harus langsung diberi nilai: const x = ..."],
  [/has already been declared/i, "Nama variabel/function dideklarasikan dua kali di scope yang sama."],
  [/await is only valid/i, "await dipakai di luar function async."],
  [/Cannot use import statement|Unexpected token 'export'/i, "Kode memakai import/export (ES Module) tetapi dijalankan sebagai CommonJS."],
  [/Unexpected token/i, "Ada simbol di tempat yang salah. Cek baris tersebut dan baris sebelumnya."],
  [/Invalid regular expression/i, "Regex tidak valid. Cek tanda kurung dan escape di regex."],
];

export function hintFor(message = "") {
  for (const [re, text] of HINTS) if (re.test(message)) return text;
  return "Cek baris yang disebutkan dan baris sebelumnya.";
}

/** Jalankan `node --check` pada file sementara. Kode TIDAK dieksekusi. */
async function nodeCheck(code, ext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jscheck-"));
  const file = path.join(dir, `code.${ext}`);
  try {
    await fs.writeFile(file, code, "utf8");
    return await new Promise((resolve) => {
      execFile(process.execPath, ["--check", file], { timeout: 10_000, windowsHide: true }, (err, _out, stderr) => {
        if (!err) return resolve({ ok: true });
        if (err.killed || err.code === "ENOENT") return resolve({ ok: null, fatal: err.message });
        resolve({ ok: false, stderr: String(stderr || "") });
      });
    });
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseNodeStderr(stderr, code) {
  const locMatch = stderr.match(/code\.(?:cjs|mjs):(\d+)/);
  const msgMatch = stderr.match(/^((?:\w*Error): .+)$/m);
  const line = locMatch ? Number(locMatch[1]) : null;
  const message = msgMatch ? msgMatch[1].trim() : (stderr.trim().split("\n").pop() || "Syntax error");
  const all = code.split(/\r?\n/);
  let snippet = line ? (all[line - 1] ?? "").trim() : "";
  // "Unexpected end of input" menunjuk baris kosong di akhir file -> tampilkan baris kode terakhir
  for (let i = (line || 0) - 2; !snippet && i >= 0; i--) snippet = (all[i] ?? "").trim();
  return { message, line, snippet, hint: hintFor(message) };
}

/** Fallback bila `node --check` tidak bisa dijalankan (hanya untuk CommonJS) */
function vmCheck(code) {
  try {
    new vm.Script(`(function(exports, require, module, __filename, __dirname){${code}\n})`, { filename: "code.cjs" });
    return { valid: true, module: "CJS" };
  } catch (e) {
    const m = String(e.stack || "").match(/code\.cjs:(\d+)/);
    const line = m ? Math.max(1, Number(m[1])) : null; // wrapper ada di baris yang sama dengan baris 1
    const message = `${e.name}: ${e.message}`;
    return { valid: false, module: "CJS", error: { message, line, snippet: line ? (code.split(/\r?\n/)[line - 1] ?? "").trim() : "", hint: hintFor(message) } };
  }
}

/**
 * Cek syntax kode JS. Return:
 *   { valid: true,  module: "ESM" | "CJS" }
 *   { valid: false, module, error: { message, line, snippet, hint } }
 * Hanya error SYNTAX yang terdeteksi (kode tidak dijalankan, jadi error saat runtime tidak ketahuan).
 */
export async function checkSyntax(code) {
  code = String(code).replace(/^\uFEFF/, "");
  const isEsm = ESM_RE.test(code);
  let ext = isEsm ? "mjs" : "cjs";
  let res = await nodeCheck(code, ext);

  if (res.ok === null) {
    if (isEsm) throw new Error("Tidak bisa menjalankan pengecekan syntax ES Module: " + res.fatal);
    return vmCheck(code);
  }
  if (res.ok) return { valid: true, module: isEsm ? "ESM" : "CJS" };

  // Gagal sebagai CJS padahal ciri-cirinya ES Module -> coba lagi sebagai .mjs
  if (!isEsm && NEEDS_ESM_RE.test(res.stderr)) {
    const retry = await nodeCheck(code, "mjs");
    if (retry.ok) return { valid: true, module: "ESM" };
    if (retry.ok === false) {
      ext = "mjs";
      res = retry;
    }
  }
  return { valid: false, module: ext === "mjs" ? "ESM" : "CJS", error: parseNodeStderr(res.stderr, code) };
}

/** Deteksi tipe modul secara cepat (untuk prompt AI) */
export const detectModuleType = (code) => (ESM_RE.test(code) ? "ESM" : "CJS");

// ─── Ambil kode dari pesan ────────────────────────────────────────────────────
const OK_MIME = new Set(["application/javascript", "text/javascript", "application/x-javascript", "text/plain"]);

async function readDocument(ctx, doc) {
  const name = doc.file_name || "";
  const okExt = /\.(?:[cm]?js|txt)$/i.test(name);
  if (!okExt && !OK_MIME.has(doc.mime_type)) {
    return { error: "File harus berformat .js, .mjs, .cjs, atau .txt." };
  }
  if ((doc.file_size || 0) > MAX_CODE_BYTES) {
    return { error: `File terlalu besar (maks ${MAX_CODE_BYTES / 1024} KB).` };
  }
  const link = await ctx.telegram.getFileLink(doc.file_id);
  const buf = await getBuffer(link.href);
  return { code: buf.toString("utf-8"), fileName: name || "code.js" };
}

/**
 * Urutan sumber kode:
 *  1) pesan yang di-reply (file atau teks/caption)
 *  2) file yang dikirim bersama command (command ditulis di caption)
 *  3) teks setelah command (mendukung multi-baris)
 * Return { code, fileName } | { error } | null (tidak ada kode sama sekali)
 */
export async function readCodeFromCtx(ctx) {
  const msg = ctx.message;
  const reply = msg?.reply_to_message;
  let found = null;

  if (reply?.document) found = await readDocument(ctx, reply.document);
  else if (reply?.text?.trim()) found = { code: reply.text, fileName: "code.js" };
  else if (reply?.caption?.trim()) found = { code: reply.caption, fileName: "code.js" };

  if (!found && msg?.document) found = await readDocument(ctx, msg.document);

  if (!found) {
    const raw = msg?.text || msg?.caption || "";
    const inline = raw.replace(/^\S+\s*/, ""); // buang "/cekerror" (spasi & baris baru kode tetap utuh)
    if (inline.trim()) found = { code: inline, fileName: "code.js" };
  }

  if (!found) return null;
  if (found.error) return found;
  if (!found.code.trim()) return { error: "File/teks kosong." };
  if (Buffer.byteLength(found.code, "utf8") > MAX_CODE_BYTES) {
    return { error: `Kode terlalu besar (maks ${MAX_CODE_BYTES / 1024} KB).` };
  }
  return found;
}

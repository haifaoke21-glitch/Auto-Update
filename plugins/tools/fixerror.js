// plugins/tools/fixerror.js
// Perbaiki syntax error kode / file JavaScript otomatis memakai AI (config.js -> ai).
// Hasil diverifikasi ulang dengan pengecekan syntax Node.js; diulang sampai valid (maks MAX_PASS).

import config from "../../config.js";
import { chat } from "../../src/lib/ai.js";
import { checkSyntax, readCodeFromCtx, detectModuleType } from "../../src/lib/jsSyntax.js";
import { escH } from "../../src/lib/util.js";

// Pengaturan dari config.js (fixError.*), fallback ke ai.* bila kosong
const cfg = () => {
  const f = config.fixError || {};
  return {
    apiKey: f.apiKey || process.env.FIXERROR_API_KEY || config.ai?.apiKey || "",
    baseUrl: f.baseUrl || config.ai?.baseUrl,
    model: f.model || config.ai?.model,
    maxPass: Math.max(1, Math.min(Number(f.maxPass) || 4, 8)),
  };
};
const MAX_FIX_CHARS = 30_000;  // batas panjang kode yang dikirim ke AI
const NO_ANSWER = "(tidak ada jawaban)"; // nilai balik chat() saat AI tidak menjawab

const OK = `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>`;
const NO = `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>`;
const WARN = `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>`;
const WAIT = `<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji>`;
const html = { parse_mode: "HTML" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set(); // satu proses per user

function systemPrompt(moduleType, pass) {
  return [
    "You are an expert JavaScript and Node.js programmer.",
    "Your ONLY task is to fix SYNTAX errors in the provided code so that it parses without errors.",
    "STRICT RULES:",
    "- Output ONLY the complete fixed code. No explanation, no markdown, no backticks.",
    "- Do NOT change logic, behavior, function names, variable names, or structure.",
    "- Do NOT remove or rewrite existing comments, console.log calls, or variables.",
    "- Do NOT shorten, summarize, or omit any part of the code. Return the entire file.",
    "- Fix only syntax: missing or extra brackets, braces, parentheses, quotes, backticks, commas, semicolons; close unclosed blocks.",
    moduleType === "ESM"
      ? "- This is an ES Module. Keep import/export statements; do NOT convert them to require()/module.exports."
      : "- This is CommonJS. Keep require()/module.exports; do NOT convert them to import/export.",
    pass >= 3
      ? "- Previous attempts still failed. Scan EVERY line: check each string is closed, every opening bracket has its closing one, and each statement is well formed."
      : "",
  ].filter(Boolean).join("\n");
}

function userPrompt(code, err) {
  const where = err.line ? ` at line ${err.line}${err.snippet ? ` (${err.snippet.slice(0, 160)})` : ""}` : "";
  return `Node.js reports this syntax error: ${err.message}${where}\n\nFix the code below and return the full corrected code only:\n\n${code}`;
}

/** Ambil kode dari jawaban AI (buang pagar ``` bila ada) */
function extractCode(out) {
  const s = String(out || "").trim();
  const blocks = [...s.matchAll(/```[a-zA-Z]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim() + "\n";
  return s.replace(/^```[a-zA-Z]*\r?\n/, "").replace(/\r?\n```\s*$/, "").trim() + "\n";
}

// Hasil AI yang jauh lebih pendek/panjang dari aslinya = kemungkinan terpotong atau kode diubah
const sizeLooksSane = (orig, fixed) => fixed.length >= orig.length * 0.6 && fixed.length <= orig.length * 1.5 + 200;

export default {
  command: ["fixerror"],
  category: "tools",
  description: "Perbaiki syntax error kode/file JS otomatis (AI). Reply file .js atau teks kode, lalu /fixerror",
  cooldown: 15000,
  loading: false,
  run: async (ctx) => {
    const { apiKey, baseUrl, model, maxPass: MAX_PASS } = cfg();
    if (!apiKey) {
      return ctx.reply(`${WARN} Fitur ini belum aktif. Owner perlu mengisi fixError.apiKey atau ai.apiKey di config.js.`, html);
    }

    let input;
    try {
      input = await readCodeFromCtx(ctx);
    } catch (err) {
      return ctx.reply(`${NO} Gagal membaca file: ${escH(err.message)}`, html);
    }
    if (!input) {
      return ctx.reply(
        `${WARN} <b>Cara pakai /fixerror</b>\n\nReply file <code>.js</code> atau pesan teks berisi kode yang error, lalu kirim <code>/fixerror</code>.\nBisa juga kirim file dengan caption <code>/fixerror</code>.`,
        html
      );
    }
    if (input.error) return ctx.reply(`${NO} ${escH(input.error)}`, html);

    const { code, fileName } = input;
    if (code.length > MAX_FIX_CHARS) {
      return ctx.reply(`${NO} Kode terlalu panjang untuk diperbaiki AI (${code.length} karakter, maks ${MAX_FIX_CHARS}). Kirim bagian yang error saja atau pecah filenya.`, html);
    }

    const uid = ctx.from.id;
    if (running.has(uid)) return ctx.reply(`${WARN} Perbaikan sebelumnya masih berjalan, tunggu selesai dulu.`, html);

    let before;
    try {
      before = await checkSyntax(code);
    } catch (err) {
      return ctx.reply(`${NO} Gagal mengecek: ${escH(err.message)}`, html);
    }
    if (before.valid) return ctx.reply(`${OK} Kode sudah valid, tidak ada syntax error.`, html);

    running.add(uid);
    const chatId = ctx.chat.id;
    const status = await ctx.reply(`${WAIT} Membaca kode...\nError: ${escH(before.error.message.slice(0, 100))}`, html).catch(() => null);
    const setStatus = (text) =>
      status && ctx.telegram.editMessageText(chatId, status.message_id, undefined, text, html).catch(() => {});
    const typing = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);

    const moduleType = detectModuleType(code);
    let current = code;
    let currentErr = before.error;
    let valid = false;
    let pass = 0;
    let aiErrors = 0;
    let authFail = false;
    let lastAiErr = "";
    // max_tokens dinamis: Groq menghitung max_tokens ke batas TPM, jadi 16000 tetap bisa ditolak (413/429)
    const maxTokens = Math.min(8000, Math.max(1024, Math.ceil(code.length / 2) + 512));

    try {
      while (pass < MAX_PASS) {
        pass++;
        await setStatus(`${WAIT} Memperbaiki — percobaan ${pass}/${MAX_PASS}...\nError: ${escH(currentErr.message.slice(0, 100))}`);

        let candidate;
        try {
          const out = await chat(
            [
              { role: "system", content: systemPrompt(moduleType, pass) },
              { role: "user", content: userPrompt(current, currentErr) },
            ],
            { temperature: 0.1, maxTokens, apiKey, baseUrl, model }
          );
          if (out === NO_ANSWER) throw new Error("AI tidak memberi jawaban");
          candidate = extractCode(out);
        } catch (err) {
          const st = err.response?.status;
          lastAiErr = `${st || err.code || "ERR"}: ${err.response?.data?.error?.message || err.message}`;
          console.error("[FIXERROR] AI error:", lastAiErr);
          if (st === 401 || st === 403) { authFail = true; break; }
          if (++aiErrors >= 2) break;
          await sleep(st === 429 ? 5000 : 3000);
          pass--; // percobaan gagal karena jaringan/limit tidak dihitung
          continue;
        }

        if (!sizeLooksSane(code, candidate)) continue; // kemungkinan terpotong / diubah jauh -> abaikan, coba lagi

        const res = await checkSyntax(candidate);
        current = candidate;
        if (res.valid) { valid = true; break; }
        currentErr = res.error;
      }
    } catch (err) {
      console.error("[FIXERROR]", err);
      clearInterval(typing);
      running.delete(uid);
      if (status) ctx.telegram.deleteMessage(chatId, status.message_id).catch(() => {});
      return ctx.reply(`${NO} Terjadi error: ${escH(err.message)}`, html);
    }

    clearInterval(typing);
    running.delete(uid);
    if (status) ctx.telegram.deleteMessage(chatId, status.message_id).catch(() => {});

    if (authFail) return ctx.reply(`${NO} API key AI tidak valid atau ditolak. Owner perlu memeriksa fixError.apiKey / ai.apiKey di config.js.`, html);
    if (current === code) {
      const why = lastAiErr ? `\nAlasan: <code>${escH(lastAiErr.slice(0, 200))}</code>` : "";
      return ctx.reply(`${NO} Gagal memperbaiki kode (AI tidak memberi hasil yang bisa dipakai). Coba lagi nanti.${why}`, html);
    }

    const outName = `fixed_${fileName.replace(/^fixed_/, "")}`;
    const caption = valid
      ? `${OK} <b>Fix error selesai</b>\nFile: <code>${escH(fileName)}</code>\nPercobaan: ${pass}x\nStatus: syntax valid\n\n${WARN} Hasil diperbaiki AI, cek dulu sebelum dipakai.`
      : `${WARN} <b>Fix error parsial</b>\nFile: <code>${escH(fileName)}</code>\nPercobaan: ${pass}x\nSisa error${currentErr.line ? ` (baris ${currentErr.line})` : ""}: <code>${escH(currentErr.message.slice(0, 200))}</code>`;

    await ctx.replyWithDocument({ source: Buffer.from(current, "utf-8"), filename: outName }, { caption, parse_mode: "HTML" });
  },
};

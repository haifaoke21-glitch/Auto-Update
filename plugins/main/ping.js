import os from "os";
import { performance } from "perf_hooks";

// /ping — status bot dalam format Rich Message Telegram (Bot API 10.1+):
// judul, tabel latency, skor koneksi, dan Health Check berupa checklist.
// Kalau server menolak Rich Message, otomatis jatuh ke teks HTML biasa.

const SAMPLES = 3; // jumlah ping ke Bot API
const LATENCY_LIMIT = 800; // ms, batas latency sehat
const EDIT_LIMIT = 1000; // ms, batas edit pesan responsif
const MEM_LIMIT = 80; // % RAM server yang dipakai proses
const CPU_LIMIT = 0.8; // load average 1 menit per core

let richDisabled = false; // jadi true kalau server tidak mengenal method rich

const ms = (n) => `${Math.round(n)} ms`;
const notModified = (e) => /message is not modified/i.test(e?.message || "");
const unsupported = (e) => /not found|unknown method/i.test(e?.message || "");

function icon(latency) {
  return latency < 300 ? "🟢" : latency < 800 ? "🟡" : "🔴";
}

function headline(score) {
  if (score >= 80) return "🟢 Cepat - koneksi lancar";
  if (score >= 50) return "🟡 Sedang - koneksi cukup";
  return "🔴 Lambat - koneksi bermasalah";
}

function bar(score) {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/** Skor 0-100 dari latency rata-rata, jitter, kecepatan edit, dan sampel yang gagal */
function scoreOf({ avg, jitter, edit, ok }) {
  if (!ok) return 0;
  let penalty = Math.max(0, avg - 50) * 0.06 + Math.max(0, edit - 100) * 0.02 + jitter * 0.5;
  penalty += (SAMPLES - ok) * 15;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

async function measure(telegram) {
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = performance.now();
    try {
      await telegram.getMe();
      times.push(performance.now() - t);
    } catch {
      /* sampel gagal, tidak dihitung */
    }
  }
  const ok = times.length;
  const avg = ok ? times.reduce((a, b) => a + b, 0) / ok : 0;
  const min = ok ? Math.min(...times) : 0;
  const max = ok ? Math.max(...times) : 0;
  let jitter = 0;
  if (ok > 1) {
    const diffs = times.slice(1).map((v, i) => Math.abs(v - times[i]));
    jitter = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }
  return { ok, avg, min, max, jitter };
}

function systemInfo() {
  const memPct = (process.memoryUsage().rss / os.totalmem()) * 100;
  const load = os.loadavg()[0] / Math.max(os.cpus().length, 1);
  return { memPct, load };
}

function buildChecks(r, edit, sys) {
  return [
    [r.ok > 0, r.ok > 0 ? "Koneksi ke Telegram tersambung" : "Koneksi ke Telegram gagal"],
    [r.ok === SAMPLES, `Ping Bot API sukses ${r.ok}/${SAMPLES} sampel`],
    [r.ok > 0 && r.avg < LATENCY_LIMIT, r.avg < LATENCY_LIMIT ? `Latency di bawah ${LATENCY_LIMIT} ms - sekarang ${Math.round(r.avg)} ms` : `Latency tinggi - ${Math.round(r.avg)} ms`],
    [edit < EDIT_LIMIT, edit < EDIT_LIMIT ? `Edit pesan responsif - ${Math.round(edit)} ms` : `Edit pesan lambat - ${Math.round(edit)} ms`],
    [sys.memPct < MEM_LIMIT, sys.memPct < MEM_LIMIT ? `Memory proses aman - ${sys.memPct.toFixed(1)}% dari RAM server` : `Memory proses tinggi - ${sys.memPct.toFixed(1)}% dari RAM server`],
    [sys.load < CPU_LIMIT, sys.load < CPU_LIMIT ? "Beban CPU normal" : "Beban CPU tinggi"],
  ];
}

function buildRich(r, edit, sys, score, checks) {
  const rows = [
    ["Edit pesan", ms(edit)],
    ["Bot API rata-rata", ms(r.avg)],
    ["Bot API tercepat", ms(r.min)],
    ["Bot API terlambat", ms(r.max)],
    ["Jitter", ms(r.jitter)],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  return (
    `<h1><tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Pong! Status Bot</h1>` +
    `<p>${headline(score)}</p>` +
    `<hr/>` +
    `<h2>${icon(r.avg)} Latency</h2>` +
    `<table bordered><tr><th>Metrik</th><th>Hasil</th></tr>${rows}` +
    `<tr><td>Skor koneksi</td><td>${bar(score)}<br>${score}%</td></tr></table>` +
    `<h2>${checks.every(([ok]) => ok) ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji>" : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>"} Health Check</h2>` +
    `<ul>${checks.map(([ok, t]) => `<li><input type="checkbox"${ok ? " checked" : ""}>${t}</li>`).join("")}</ul>`
  );
}

function buildLegacy(r, edit, sys, score, checks) {
  return (
    `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Pong! Status Bot</b>\n${headline(score)}\n\n` +
    `${icon(r.avg)} <b>Latency</b>\n` +
    `• Edit pesan: <code>${ms(edit)}</code>\n` +
    `• Bot API rata-rata: <code>${ms(r.avg)}</code>\n` +
    `• Bot API tercepat: <code>${ms(r.min)}</code>\n` +
    `• Bot API terlambat: <code>${ms(r.max)}</code>\n` +
    `• Jitter: <code>${ms(r.jitter)}</code>\n` +
    `• Skor koneksi: <code>${bar(score)}</code> ${score}%\n\n` +
    `${checks.every(([ok]) => ok) ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji>" : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>"} <b>Health Check</b>\n` +
    checks.map(([ok, t]) => `${ok ? "✅" : "❌"} ${t}`).join("\n")
  );
}

export default {
  command: ["ping"],
  category: "main",
  description: "Cek kecepatan respon & kesehatan bot",
  loading: false, // ping mengukur waktu sendiri, jangan ada pesan loading tambahan
  run: async (ctx) => {
    const tg = ctx.telegram;
    const chat_id = ctx.chat.id;
    const thread = ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    const reply_parameters = { message_id: ctx.message.message_id, allow_sending_without_reply: true };
    const placeholder = (t) => `<p>${t}</p>`;

    // 1) Pesan awal (rich kalau bisa)
    let sent = null;
    let rich = false;
    if (!richDisabled) {
      try {
        sent = await tg.callApi("sendRichMessage", { chat_id, rich_message: { html: placeholder("🏓 Pong! Mengukur koneksi...") }, reply_parameters, ...thread });
        rich = true;
      } catch (err) {
        if (unsupported(err)) richDisabled = true;
        else console.warn("[PING] Rich Message gagal, pakai teks biasa:", err?.message);
      }
    }
    if (!sent) sent = await ctx.reply("<tg-emoji emoji-id=\"5456140674028019486\">🏓</tg-emoji> Pong! Mengukur koneksi...", { parse_mode: "HTML", reply_parameters });

    const edit = (html, text) =>
      rich
        ? tg.callApi("editMessageText", { chat_id, message_id: sent.message_id, rich_message: { html } })
        : tg.editMessageText(chat_id, sent.message_id, undefined, text);

    // 2) Ukur Bot API (getMe x3)
    const r = await measure(tg);

    // 3) Ukur kecepatan edit pesan
    let editMs = 0;
    const t0 = performance.now();
    try {
      await edit(placeholder("🏓 Mengukur kecepatan edit..."), "🏓 Mengukur kecepatan edit...");
      editMs = performance.now() - t0;
    } catch (err) {
      if (!notModified(err)) editMs = EDIT_LIMIT * 2; // edit gagal = dianggap sangat lambat
      else editMs = performance.now() - t0;
    }

    // 4) Hasil akhir
    const sys = systemInfo();
    const score = scoreOf({ ...r, edit: editMs });
    const checks = buildChecks(r, editMs, sys);

    try {
      if (rich) {
        await edit(buildRich(r, editMs, sys, score, checks));
      } else {
        await tg.editMessageText(chat_id, sent.message_id, undefined, buildLegacy(r, editMs, sys, score, checks), { parse_mode: "HTML" });
      }
    } catch (err) {
      if (notModified(err)) return;
      // Rich gagal di tengah jalan -> hapus pesan awal, kirim versi teks biasa
      console.warn("[PING] Edit hasil gagal, kirim teks biasa:", err?.message);
      if (unsupported(err)) richDisabled = true;
      await tg.deleteMessage(chat_id, sent.message_id).catch(() => {});
      await ctx.reply(buildLegacy(r, editMs, sys, score, checks), { parse_mode: "HTML", reply_parameters });
    }
  },
};

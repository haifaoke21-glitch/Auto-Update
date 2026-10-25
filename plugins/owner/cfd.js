import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import {
  esc,
  createPending, getPending, deletePending, toggleTarget, tryLockBusy, unlockBusy,
  startRun, endRun, isStopped, stopRun,
  countTargets, executeBroadcast, summarizeFailures,
} from "../../src/lib/cfd.js";

// ───────────────────────── Tampilan (Rich Message) ─────────────────────────
// Format Rich Message Telegram (Bot API 10.1+): <h2>, <table bordered striped>, <hr/>, <details>.
// Kalau server menolak Rich Message, otomatis jatuh ke teks HTML biasa (versi legacy).
let richDisabled = false; // jadi true kalau server tidak mengenal method rich

const unsupported = (e) => /not found|unknown method/i.test(e?.message || "");
const notModified = (e) => /message is not modified/i.test(e?.message || "");
// Buang field "style" tombol (warna hijau/merah) -- dipakai sebagai cadangan kalau server menolaknya
const noStyle = (rm) => (rm?.inline_keyboard ? { inline_keyboard: rm.inline_keyboard.map((r) => r.map(({ style, ...b }) => b)) } : rm);
const stripHtml = (h) => String(h).replace(/<[^>]*>/g, "");

const table = (head, rows) =>
  `<table bordered striped><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr>` +
  rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("") +
  `</table>`;

// ── Pilih target
const TARGET_RICH =
  `<h2>🎯 CFD - Pilih Target</h2>` +
  `<p>Tekan tombol untuk menyalakan/mematikan target (bisa lebih dari satu).</p>` +
  `<p><tg-emoji emoji-id="6120946172010959542">🟢</tg-emoji> = aktif, <tg-emoji emoji-id="5411225014148014586">🔴</tg-emoji> = mati. Kalau sudah yakin, tekan <b>MULAI CFD</b>.</p>`;
const TARGET_LEGACY =
  "<b><tg-emoji emoji-id=\"6154335299309672955\">🎯</tg-emoji> CFD - Pilih Target</b>\n\n" +
  "Tekan tombol untuk menyalakan/mematikan target (bisa lebih dari satu).\n" +
  "<tg-emoji emoji-id=\"6120946172010959542\">🟢</tg-emoji> = aktif, <tg-emoji emoji-id=\"5411225014148014586\">🔴</tg-emoji> = mati. Kalau sudah yakin, tekan <b>MULAI CFD</b>.";
const TARGET_VIEW = { rich: TARGET_RICH, legacy: TARGET_LEGACY };

// ── Progres
function progressView(done, total) {
  return {
    rich:
      `<h2><tg-emoji emoji-id="6129639980387015660">🚀</tg-emoji> CFD Sedang Berjalan (${done}/${total})</h2>` +
      `<p>CFD sedang mengirim pesan ke semua target. Tekan tombol <b>STOP CFD</b> di bawah untuk menghentikan proses ini.</p>`,
    legacy: `<b><tg-emoji emoji-id="6129639980387015660">🚀</tg-emoji> CFD Sedang Berjalan (${done}/${total})</b>\n\nTekan <b>STOP CFD</b> untuk menghentikan.`,
  };
}

// ── Laporan akhir
function reportView(label, r) {
  const sent = r.successCount + r.failCount;
  const skipped = r.stopped ? Math.max(0, r.totalTargets - sent) : 0;
  const reasons = r.failCount > 0 ? summarizeFailures(r.failures) : [];
  const title = r.stopped ? `⛔ CFD Dihentikan (${label})` : `✅ CFD Selesai (${label})`;

  const rows = [
    ["Berhasil", String(r.successCount)],
    ["Gagal", String(r.failCount)],
  ];
  if (r.stopped) rows.push(["Dilewati", String(skipped)]);

  let rich = `<h2>${title}</h2>` + table(["Status", "Jumlah"], rows);
  if (reasons.length) {
    rich +=
      `<details><summary><b><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Lihat alasan gagal (${reasons.length})</b></summary>` +
      `<p>${reasons.map((x) => `• ${x}`).join("<br>")}</p></details>`;
  }

  let legacy = `<b>${title}</b>\n\nBerhasil: <b>${r.successCount}</b>\nGagal: <b>${r.failCount}</b>`;
  if (r.stopped) legacy += `\nDilewati: <b>${skipped}</b>`;
  if (reasons.length) legacy += `\n\n<b>Penyebab gagal:</b>\n${reasons.map((x) => `- ${x}`).join("\n")}`;

  return { rich, legacy };
}

// ── Pesan sederhana (dibatalkan, error, dsb.)
const simpleView = (text) => ({ rich: `<p>${text}</p>`, legacy: text });

function targetRows(token, t) {
  const btn = (label, key) => ({
    text: `${t[key] ? "\u{1F7E2}" : "\u{1F534}"} ${label}`,
    callback_data: `cfd:t:${key}:${token}`,
    style: t[key] ? "success" : "danger", // hijau = dipilih, merah = belum
  });
  return [
    [btn("Channel", "channel"), btn("User", "contact")],
    [btn("Grup", "group")],
    [
      { text: "\u25B6\uFE0F MULAI CFD", callback_data: `cfd:start:${token}`, style: "success" },
      { text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `cfd:cancel:${token}`, style: "danger" },
    ],
  ];
}

// ───────────────────────── Callback ─────────────────────────
registerCallback("cfd", async (ctx, args) => {
  const action = args[0];
  const token = args[args.length - 1];

  if (!isOwner(ctx.from.id)) {
    return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });
  }

  const msg = ctx.callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  // Edit pesan: Rich Message dulu, kalau ditolak server jatuh ke HTML biasa
  const edit = async (view, reply_markup) => {
    const tries = [];
    if (!richDisabled) {
      tries.push(["rich", () => ctx.telegram.callApi("editMessageText", { chat_id: chatId, message_id: messageId, rich_message: { html: view.rich }, ...(reply_markup ? { reply_markup } : {}) })]);
      if (reply_markup) tries.push(["rich-nostyle", () => ctx.telegram.callApi("editMessageText", { chat_id: chatId, message_id: messageId, rich_message: { html: view.rich }, reply_markup: noStyle(reply_markup) })]);
    }
    tries.push(["html", () => ctx.telegram.editMessageText(chatId, messageId, undefined, view.legacy, { parse_mode: "HTML", reply_markup })]);
    if (reply_markup) tries.push(["html-nostyle", () => ctx.telegram.editMessageText(chatId, messageId, undefined, view.legacy, { parse_mode: "HTML", reply_markup: noStyle(reply_markup) })]);
    tries.push(["plain", () => ctx.telegram.editMessageText(chatId, messageId, undefined, stripHtml(view.legacy), { reply_markup: noStyle(reply_markup) })]);
    for (const [name, fn] of tries) {
      try {
        await fn();
        return;
      } catch (e) {
        if (notModified(e)) return;
        if (name === "rich" && unsupported(e)) richDisabled = true;
        console.error(`[CFD] edit ${name}:`, e?.response?.description || e.message);
      }
    }
  };

  // Tombol STOP
  if (action === "stop") {
    if (!stopRun(token)) {
      return ctx.answerCbQuery("Proses sudah selesai.", { show_alert: true });
    }
    return ctx.answerCbQuery("Menghentikan setelah target saat ini...");
  }

  const req = getPending(token);
  if (!req) {
    return ctx.answerCbQuery("Sesi sudah kedaluwarsa. Ketik /cfd lagi.", { show_alert: true });
  }

  if (action === "cancel") {
    deletePending(token);
    await edit(simpleView("❌ CFD dibatalkan."));
    return ctx.answerCbQuery();
  }

  // Toggle dikunci supaya klik beruntun tidak saling tabrak
  if (action === "t") {
    if (!tryLockBusy(token)) return ctx.answerCbQuery("Tunggu sebentar...");
    try {
      const updated = toggleTarget(token, args[1]);
      if (!updated) return ctx.answerCbQuery("Sesi kedaluwarsa.", { show_alert: true });
      await edit(TARGET_VIEW, { inline_keyboard: targetRows(token, updated.targets) });
      return ctx.answerCbQuery();
    } finally {
      unlockBusy(token);
    }
  }

  // MULAI CFD: langsung jalankan broadcast (metode COPY PASTE)
  if (action === "start") {
    if (!tryLockBusy(token)) return ctx.answerCbQuery("Tunggu sebentar...");
    try {
      const { group, channel, contact } = req.targets;
      if (!group && !channel && !contact) {
        return ctx.answerCbQuery("Pilih minimal satu target dulu.", { show_alert: true });
      }
      const counts = countTargets(req.targets, req.sourceChatId);
      if (counts.total === 0) {
        return ctx.answerCbQuery(
          "Tidak ada target untuk pilihan ini (semua kosong atau masuk blacklist).",
          { show_alert: true }
        );
      }
    } finally {
      unlockBusy(token);
    }

    deletePending(token); // token hangus supaya tidak bisa ditekan dobel
    await ctx.answerCbQuery("Mulai mengirim...");

    const label = "COPY PASTE";
    const stopKeyboard = { inline_keyboard: [[{ text: "\u26D4 STOP CFD", callback_data: `cfd:stop:${token}`, style: "danger" }]] };
    await edit(progressView(0, 0), stopKeyboard);
    startRun(token);

    // Dijalankan di latar belakang (tidak di-await) supaya update Telegram lain
    // tidak tertahan dan tombol STOP tetap bisa ditekan selama proses berjalan.
    let lastEdit = 0;
    (async () => {
      try {
        const report = await executeBroadcast(ctx.telegram, req, "copy", {
          onStart: (total) => edit(progressView(0, total), stopKeyboard),
          onProgress: async (done, total) => {
            const now = Date.now();
            if (now - lastEdit < 1500 && done < total) return; // batasi frekuensi edit
            lastEdit = now;
            await edit(progressView(done, total), stopKeyboard);
          },
          shouldStop: () => isStopped(token),
        });
        await edit(reportView(label, report));
      } catch (err) {
        console.error("[CFD] Broadcast error:", err);
        await edit(simpleView(`⚠️ CFD gagal: ${esc(err.message)}`));
      } finally {
        endRun(token);
      }
    })();
  }
});

// ───────────────────────── Command ─────────────────────────
export default {
  command: ["cfd"],
  category: "owner",
  description: "Sebar pesan ke grup/channel/user pilihan (balas pesannya, lalu ketik /cfd)",
  ownerOnly: true,
  loading: false,
  run: async (ctx) => {
    const src = ctx.message.reply_to_message;
    if (!src) {
      return ctx.reply("Balas (reply) pesan yang mau disebar, lalu ketik /cfd.");
    }

    // Simpan SEMUA tombol inline dari pesan sumber (URL, callback, switch inline, copy text, dll).
    // Dipakai metode COPY PASTE; tombol callback tetap berfungsi karena bot ini yang mengirim salinannya.
    const buttonRows = (src.reply_markup?.inline_keyboard || []).map((row) => row.map((b) => ({ ...b }))).filter((row) => row.length);

    const token = createPending({
      ownerId: ctx.from.id,
      sourceChatId: ctx.chat.id,
      sourceMessageId: src.message_id,
      buttonRows,
    });

    const reply_markup = { inline_keyboard: targetRows(token, { group: false, channel: false, contact: false }) };
    const replyParams = { message_id: ctx.message.message_id, allow_sending_without_reply: true };
    const thread = ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};

    // Urutan percobaan: Rich -> Rich tanpa warna tombol -> HTML -> HTML tanpa warna -> teks polos.
    // Setiap kegagalan dicatat di log supaya penyebab aslinya kelihatan.
    const tries = [];
    if (!richDisabled) {
      const rich = (rm) => ctx.telegram.callApi("sendRichMessage", { chat_id: ctx.chat.id, rich_message: { html: TARGET_RICH }, reply_markup: rm, reply_parameters: replyParams, ...thread });
      tries.push(["rich", () => rich(reply_markup)], ["rich-nostyle", () => rich(noStyle(reply_markup))]);
    }
    tries.push(
      ["html", () => ctx.reply(TARGET_LEGACY, { parse_mode: "HTML", reply_markup })],
      ["html-nostyle", () => ctx.reply(TARGET_LEGACY, { parse_mode: "HTML", reply_markup: noStyle(reply_markup) })],
      ["plain", () => ctx.reply(stripHtml(TARGET_LEGACY), { reply_markup: noStyle(reply_markup) })]
    );
    let lastErr;
    for (const [name, fn] of tries) {
      try {
        await fn();
        return;
      } catch (e) {
        lastErr = e;
        if (name === "rich" && unsupported(e)) richDisabled = true;
        console.error(`[CFD] kirim menu (${name}) gagal:`, e?.response?.description || e.message);
      }
    }
    throw lastErr;
  },
};

import { startSender, listSenders, listSendersFor, removeSender, getSenderOwner, setSenderOwner, selectSender, getSelectedSenderId } from "../../src/lib/whatsappSender.js";
import { isOwner } from "../../src/middleware.js";
import { sendRich, h, richTable } from "../../src/lib/rich.js";

// Setiap user boleh /addsender; sender yang ditambahkan hanya bisa dipakai & dikelola oleh pemiliknya.
// Owner bot bisa melihat semua sender dan memilih salah satunya lewat /pilihsender.
const MAX_SENDER_PER_USER = 3;

const ADDSENDER_COOLDOWN_MS = 30_000;
const lastAddsender = new Map(); // userId -> timestamp percobaan terakhir

/** Bersihkan nomor: buang + spasi - ( ), awalan 0 -> 62. */
function normalizeNumber(raw) {
  let n = String(raw || "").replace(/[\s+\-().]/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  return n;
}

/** Terjemahkan argumen jadi id sender: nomor urut dari /listsender (1, 2, ...) atau nomor lengkap. */
function resolveTarget(raw, uid, botOwner) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (/^\d{1,3}$/.test(t)) {
    const row = listSendersFor(uid, botOwner)[Number(t) - 1];
    return row ? row.id : "";
  }
  return normalizeNumber(t);
}

const mono = (value) => `<code>${h(value)}</code>`;
const pre = (value) => `<pre>${h(value)}</pre>`;
const bold = (value) => `<b>${h(value)}</b>`;
const italic = (value) => `<i>${h(value)}</i>`;
const statusIcon = (connected) => (connected ? "🟢" : "🟡");

/** Pesan sederhana (judul + isi). */
function simpleView(title, text) {
  return {
    rich: `<div><h2>${title}</h2><blockquote>${text}</blockquote></div>`,
    legacy: `<b>${title}</b>\n\n${text}`,
  };
}
const notYoursView = () => simpleView("✗ Bukan Sender Kamu", "Nomor urut tidak ditemukan atau sender itu bukan milikmu. Cek /listsender.");
const takenView = () => simpleView("✗ Nomor Sudah Dipakai", "Nomor itu sudah dipakai sebagai sender oleh user lain.");
const limitView = () => simpleView("✗ Batas Sender", `Kamu sudah punya ${MAX_SENDER_PER_USER} sender. Hapus salah satu dulu dengan /delsender 1 (nomor urut dari /listsender).`);
const ownerOnlyView = () => simpleView("✗ Khusus Owner", "Perintah /pilihsender hanya untuk owner bot.");
const pickUsageView = () => simpleView("Pilih Sender", "Format: <code>/pilihsender 1</code>\nLihat nomor urut lewat /listsender.");
const pickedView = (id) => simpleView("✅ Sender Dipilih", `Fitur WhatsApp (bangb, testfunc, dll) sekarang memakai sender <code>${id}</code>.`);
const pickFailedView = () => simpleView("✗ Sender Tidak Ditemukan", "Nomor itu tidak ada di daftar sender. Cek /listsender.");

/** /listsender kosong. */
function listEmptyView() {
  const body = `<blockquote><tg-emoji emoji-id="5372825386591732174">📭</tg-emoji> ${italic("Belum ada sender WhatsApp yang tersimpan.")}</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Daftar Sender WhatsApp</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Daftar Sender WhatsApp</b>\n\n<tg-emoji emoji-id="5372825386591732174">📭</tg-emoji> Belum ada sender WhatsApp yang tersimpan.`,
  };
}

/** /listsender dengan isi, ditampilkan sebagai tabel. */
function listView(rows, showOwner = false, selectedId = null) {
  const table = richTable(
    showOwner ? ["#", "Sender", "Pemilik", "Status"] : ["#", "Sender", "Nomor", "Status"],
    rows.map((s, i) => [
      String(i + 1),
      h(s.id + (s.id === selectedId ? " ★" : "")),
      h(showOwner ? (s.owner ? `ID ${s.owner}` : "-") : (s.phone || "Belum terdeteksi")),
      `${statusIcon(s.connected)} ${s.connected ? "Connected" : "Connecting"}`,
    ])
  );
  const body = table + `<p><tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Total Sender: ${bold(String(rows.length))}</p>`;

  const legacyRows = rows
    .map(
      (s, i) =>
        `${i + 1}. ${s.id}${s.id === selectedId ? " ★" : ""}${showOwner ? `\n   👤 Pemilik: ${s.owner || "-"}` : ""}\n   📱 Nomor: ${s.phone || "Belum terdeteksi"}\n   ${statusIcon(s.connected)} Status: ${s.connected ? "Connected" : "Connecting"}`
    )
    .join("\n");

  return {
    rich: `<div><h2><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Daftar Sender WhatsApp</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Daftar Sender WhatsApp</b>\n\n${legacyRows}\n\n<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Total Sender: ${rows.length}`,
  };
}

/** /delsender tanpa argumen. */
function delUsageView() {
  const body = `<blockquote><tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Format belum lengkap.</blockquote><p>Lihat nomor urut lewat /listsender.</p><pre>/delsender 1</pre>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> Hapus Sender</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> Hapus Sender</b>\n\n<tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Format:\n/delsender 1\n\nLihat nomor urut lewat /listsender.`,
  };
}

/** /delsender berhasil, tabel status. */
function delSuccessView(id) {
  const table = richTable(["Field", "Value"], [["Sender", h(id)], ["Status", "✅ SUCCESS"]]);
  const body = `<p>Sender dan sesi WhatsApp-nya telah dihapus.</p>${table}`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender Berhasil Dihapus</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender Berhasil Dihapus</b>\n\nSender ${id} dan sesi WhatsApp-nya telah dihapus.\n⌑ Status: SUCCESS`,
  };
}

/** /delsender gagal, tabel status + error. */
function delFailedView(errorMessage) {
  const table = richTable(["Field", "Value"], [["Status", "❌ FAILED"]]);
  const body = `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Terjadi kesalahan.</blockquote>${table}${pre(errorMessage)}`;
  return {
    rich: `<div><h2>✗ Gagal Menghapus Sender</h2>${body}</div>`,
    legacy: `<b>✗ Gagal Menghapus Sender</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Terjadi kesalahan.\n⌑ Status: FAILED\n\n${errorMessage}`,
  };
}

/** /addsender tanpa nomor: tampilkan contoh penggunaan yang benar. */
function usageView() {
  const body =
    `<blockquote><tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Nomor WhatsApp belum diisi.</blockquote>` +
    `<p>${bold("Format:")}</p><pre>/addsender &lt;nomor&gt;</pre>` +
    `<p>${bold("Contoh yang benar:")}</p><pre>/addsender 628123456789</pre>` +
    `<blockquote expandable><tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Aturan nomor<br/><br/>` +
    `• Gunakan kode negara (Indonesia = 62)<br/>` +
    `• Tanpa tanda + , spasi, atau tanda -<br/>` +
    `• Awalan 0 otomatis diubah jadi 62 (08123456789 → 628123456789)</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="6093587384954262033">📲</tg-emoji> Cara Menggunakan Addsender</h2>${body}</div>`,
    legacy:
      `<b><tg-emoji emoji-id="6093587384954262033">📲</tg-emoji> Cara Menggunakan Addsender</b>\n\n<tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Nomor WhatsApp belum diisi.\n\n` +
      `Format:\n/addsender <nomor>\n\nContoh yang benar:\n/addsender 628123456789\n\n` +
      `<tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Aturan nomor:\n• Gunakan kode negara (Indonesia = 62)\n• Tanpa tanda +, spasi, atau tanda -\n` +
      `• Awalan 0 otomatis diubah jadi 62 (08123456789 → 628123456789)`,
  };
}

/** /addsender dengan nomor tidak valid. */
function badFormatView() {
  const body =
    `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Nomor tidak valid. Gunakan angka saja dengan kode negara, 8-15 digit.</blockquote>` +
    `<p>${bold("Contoh yang benar:")}</p><pre>/addsender 628123456789</pre>`;
  return {
    rich: `<div><h2>✗ Format Salah</h2>${body}</div>`,
    legacy: `<b>✗ Format Salah</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Nomor tidak valid. Gunakan angka saja dengan kode negara, 8-15 digit.\n\nContoh yang benar:\n/addsender 628123456789`,
  };
}

/** Nomor sudah terhubung sebagai sender. */
function alreadyConnectedView(id, phone) {
  const body = `<blockquote><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender ${mono(phone || id)} sudah terhubung, tidak perlu ditambahkan lagi.</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Sudah Terhubung</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Sudah Terhubung</b>\n\n<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender ${phone || id} sudah terhubung, tidak perlu ditambahkan lagi.`,
  };
}

/** Nomor masih dalam proses pairing / connecting. */
function alreadyProcessingView(id) {
  const body = `<blockquote><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sender ${mono(id)} sedang diproses. Selesaikan kode yang sudah dikirim, atau tunggu ±2 menit lalu ulangi.</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sedang Diproses</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sedang Diproses</b>\n\n<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sender ${id} sedang diproses. Selesaikan kode yang sudah dikirim, atau tunggu ±2 menit lalu ulangi.`,
  };
}

/** Kode pairing tidak dipakai / koneksi gagal sebelum tertaut. */
function expiredView(id) {
  const body = `<blockquote><tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Kode untuk ${mono(id)} kedaluwarsa atau tidak dipakai. Sesi dibatalkan.</blockquote><pre>/addsender ${h(id)}</pre>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Kode Kedaluwarsa</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Kode Kedaluwarsa</b>\n\n<tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Kode untuk ${id} kedaluwarsa atau tidak dipakai. Sesi dibatalkan.\n\nUlangi:\n/addsender ${id}`,
  };
}

/** Terlalu sering memakai /addsender. */
function cooldownView(seconds) {
  const body = `<blockquote><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Tunggu ${bold(String(seconds))} detik sebelum memakai /addsender lagi.</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Jangan Terlalu Cepat</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Jangan Terlalu Cepat</b>\n\n<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Tunggu ${seconds} detik sebelum memakai /addsender lagi.`,
  };
}

/** Status awal, sender sedang disiapkan. */
function preparingView(id) {
  const table = richTable(["Field", "Value"], [["Nomor", h(id)], ["Status", "⏳ Menyiapkan..."]]);
  const body = table + `<p>Bot akan mengirim ${bold("Kode Perangkat")} setelah sesi siap.</p>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Menyiapkan Sender</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Menyiapkan Sender</b>\n\n⌑ Nomor: ${id}\n⌑ Status: Menyiapkan...\n\nBot akan mengirim Kode Perangkat setelah sesi siap.`,
  };
}

/** Kode pairing WhatsApp, kode ditampilkan di <pre> agar gampang disalin, dengan info lipat. */
function pairingCodeView(id, code) {
  const table = richTable(["Field", "Value"], [["Nomor", h(id)], ["Kode", h(code)]]);
  const steps =
    `<blockquote expandable><tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Cara pakai<br/><br/>` +
    `Buka WhatsApp → ${bold("Perangkat tertaut")} → ${bold("Tautkan perangkat")} → ` +
    `${bold("Tautkan dengan nomor telepon")}, lalu masukkan kode di atas.</blockquote>`;
  const body = table + pre(code) + `<p><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> ${italic("Kode di atas dapat langsung disalin.")}</p>` + steps;

  return {
    rich: `<div><h2><tg-emoji emoji-id="6129731845442510016">🔐</tg-emoji> Kode Perangkat WhatsApp</h2>${body}</div>`,
    legacy:
      `<b><tg-emoji emoji-id="6129731845442510016">🔐</tg-emoji> Kode Perangkat WhatsApp</b>\n\n⌑ Nomor: ${id}\n⌑ Kode: ${code}\n\n` +
      `<tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Kode di atas dapat langsung disalin.\n\n` +
      `<tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Cara pakai: Buka WhatsApp → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon, lalu masukkan kode di atas.`,
  };
}

/** Sender berhasil terhubung ke WhatsApp. */
function connectedView(id, phone) {
  const table = richTable(
    ["Field", "Value"],
    [["Sender", h(id)], ["Nomor", h(phone || id)], ["Status", "✅ SUCCESS"]]
  );
  const body = table + `<p><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> ${bold("Sender siap digunakan.")}</p>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender Berhasil Terhubung</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Sender Berhasil Terhubung</b>\n\n⌑ Sender: ${id}\n⌑ Nomor: ${phone || id}\n⌑ Status: SUCCESS\n\n<tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> Sender siap digunakan.`,
  };
}

/** Sender gagal terhubung, tampilkan pesan error asli. */
function connectFailedView(errorMessage) {
  const table = richTable(["Field", "Value"], [["Status", "❌ FAILED"]]);
  const body = `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Sender gagal terhubung.</blockquote>${table}${pre(errorMessage || "Terjadi kesalahan")}`;
  return {
    rich: `<div><h2>✗ Sender Gagal Terhubung</h2>${body}</div>`,
    legacy: `<b>✗ Sender Gagal Terhubung</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Sender gagal terhubung.\n⌑ Status: FAILED\n\n${errorMessage || "Terjadi kesalahan"}`,
  };
}

/** Sender belum mengirim kode setelah startSender selesai dipanggil. */
function waitingCodeView(id) {
  const body = `<blockquote><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sender ${mono(id)} sedang menyiapkan ${bold("Kode Perangkat")}.</blockquote>`;
  return {
    rich: `<div><h2><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Menunggu Kode</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Menunggu Kode</b>\n\n<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sender ${id} sedang menyiapkan Kode Perangkat.`,
  };
}

/** Exception tak terduga saat addsender dijalankan. */
function addsenderFailedView(id, errorMessage) {
  const table = richTable(["Field", "Value"], [["Nomor", h(id)], ["Status", "❌ FAILED"]]);
  const body = `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal menyiapkan sender.</blockquote>${table}${pre(errorMessage)}`;
  return {
    rich: `<div><h2>✗ Addsender Gagal</h2>${body}</div>`,
    legacy: `<b>✗ Addsender Gagal</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal menyiapkan sender ${id}.\n⌑ Status: FAILED\n\n${errorMessage}`,
  };
}

export default {
  command: ["addsender", "listsender", "delsender", "pilihsender"],
  category: "add",
  description: "Tambah & kelola sender WhatsApp milik sendiri (owner: lihat semua & pilih sender)",
  ownerOnly: false,
  privateOnly: false,
  cost: 0,
  cooldown: 5000,
  loading: false,

  run: async (ctx, { args }) => {
    const uid = String(ctx.from.id);
    const botOwner = isOwner(ctx.from.id);

    const cmd = String(ctx.message?.text || "")
      .split(/\s+/)[0]
      .split("@")[0]
      .replace(/^[/!]/, "")
      .toLowerCase();

    if (cmd === "listsender") {
      const rows = listSendersFor(uid, botOwner);

      if (!rows.length) {
        return sendRich(ctx.telegram, ctx.chat.id, listEmptyView());
      }

      return sendRich(ctx.telegram, ctx.chat.id, listView(rows, botOwner, botOwner ? getSelectedSenderId(uid) : null));
    }

    if (cmd === "pilihsender") {
      if (!botOwner) return sendRich(ctx.telegram, ctx.chat.id, ownerOnlyView());
      if (!args[0]) return sendRich(ctx.telegram, ctx.chat.id, pickUsageView());
      const pid = resolveTarget(args[0], uid, botOwner);
      if (!pid || !selectSender(uid, pid)) return sendRich(ctx.telegram, ctx.chat.id, pickFailedView());
      return sendRich(ctx.telegram, ctx.chat.id, pickedView(pid));
    }

    if (cmd === "delsender") {
      if (!args[0]) {
        return sendRich(ctx.telegram, ctx.chat.id, delUsageView());
      }
      const id = resolveTarget(args[0], uid, botOwner);
      if (!id || (!botOwner && getSenderOwner(id) !== uid)) {
        return sendRich(ctx.telegram, ctx.chat.id, notYoursView());
      }

      try {
        await removeSender(id);
        return sendRich(ctx.telegram, ctx.chat.id, delSuccessView(id));
      } catch (e) {
        return sendRich(ctx.telegram, ctx.chat.id, delFailedView(e?.message || String(e)));
      }
    }

    // ===== addsender =====
    if (!args.join("").trim()) {
      return sendRich(ctx.telegram, ctx.chat.id, usageView());
    }

    const id = normalizeNumber(args.join(""));
    if (!/^\d{8,15}$/.test(id)) {
      return sendRich(ctx.telegram, ctx.chat.id, badFormatView());
    }

    const current = listSenders().find((s) => s.id === id);
    if (current && getSenderOwner(id) !== uid) {
      return sendRich(ctx.telegram, ctx.chat.id, takenView());
    }
    if (!current && !botOwner && listSendersFor(uid).length >= MAX_SENDER_PER_USER) {
      return sendRich(ctx.telegram, ctx.chat.id, limitView());
    }
    if (current?.connected) {
      return sendRich(ctx.telegram, ctx.chat.id, alreadyConnectedView(id, current.phone));
    }
    if (current) {
      return sendRich(ctx.telegram, ctx.chat.id, alreadyProcessingView(id));
    }

    const wait = ADDSENDER_COOLDOWN_MS - (Date.now() - (lastAddsender.get(ctx.from.id) || 0));
    if (wait > 0) {
      return sendRich(ctx.telegram, ctx.chat.id, cooldownView(Math.ceil(wait / 1000)));
    }
    lastAddsender.set(ctx.from.id, Date.now());
    setSenderOwner(id, uid); // sender ini milik user yang menjalankan /addsender (dihapus otomatis kalau pairing gagal)

    // Setiap pesan status dikirim maksimal sekali per percobaan, dan error kirim tidak membuat crash.
    const sent = new Set();
    const once = async (key, view) => {
      if (sent.has(key)) return;
      sent.add(key);
      try {
        await sendRich(ctx.telegram, ctx.chat.id, view);
      } catch (e) {
        console.error("[addsender] gagal kirim pesan:", e?.message || e);
      }
    };

    try {
      await once("preparing", preparingView(id));

      const result = await startSender(
        id,
        (code) => once("code", pairingCodeView(id, code)),
        (status, value) => {
          if (status === "connected") return once("connected", connectedView(id, value));
          if (status === "expired") return once("end", expiredView(id));
          if (status === "error") return once("end", connectFailedView(value));
          if (status === "loggedout") return once("end", connectFailedView("Sesi logout dari WhatsApp. Ulangi /addsender."));
        }
      );

      if (result?.connected) {
        return once("connected", alreadyConnectedView(id, result.phone));
      }
      if (result?.starting && !sent.has("code")) {
        return once("waiting", alreadyProcessingView(id));
      }
      if (!sent.has("code")) {
        await once("waiting", waitingCodeView(id));
      }
    } catch (e) {
      lastAddsender.delete(ctx.from.id); // gagal start -> boleh langsung coba lagi
      return once("end", connectFailedView(e?.message || String(e)));
    }
  },
};

// /clearoff  (panel aktif)  |  /clearoff2 … /clearoff20 (panel V2–V20)
// Hapus semua server berstatus OFFLINE + user (non-admin) yang tidak punya server lagi.
// Aman: scan dulu -> tampilkan ringkasan -> hapus hanya setelah tombol konfirmasi ditekan.
import config from "../../config.js";
import { cmdName, STAFF_DENY } from "../../src/lib/cpanel/util.js";
import { h, title, note, quote, table, replyView, replyNote, editView, editCbView } from "../../src/lib/richUi.js";
import { isStaff, MAX_SLOT } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { getActiveSlot, getPanel, slotName } from "../../src/lib/cpanel/ptero.js";
import { scanOffline, deleteOffline, reportHtml, running } from "../../src/lib/cpanel/clearoff.js";

const hidden = [];
for (let v = 2; v <= MAX_SLOT; v++) hidden.push(`clearoff${v}`);

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const PREVIEW_MAX = 12;

const pending = new Map(); // token -> { uid, slot, chatId, messageId, servers, users, timer }
const newToken = () => Math.random().toString(36).slice(2, 8);

/** Tabel pratinjau (maks PREVIEW_MAX baris) untuk daftar yang akan dihapus */
function previewTable(headLabel, arr, fmt) {
  if (!arr.length) return `<p><b>${headLabel}: 0</b> — tidak ada.</p>`;
  const rows = arr.slice(0, PREVIEW_MAX).map(fmt);
  if (arr.length > PREVIEW_MAX) rows.push([`<i>… +${arr.length - PREVIEW_MAX} lainnya</i>`, ""]);
  return table([`${headLabel}: ${arr.length}`, "ID"], rows);
}

/** Eksekusi penghapusan (jalan di background, progress lewat edit pesan) */
async function execute(telegram, st) {
  const edit = (rich) => editView(telegram, st.chatId, st.messageId, rich).catch(() => {});
  const res = await deleteOffline(st.slot, st.servers, st.users, (t) => edit(note("⏳", "Clear off berjalan", h(String(t).replace(/^⏳\s*/, "")))));
  await edit(reportHtml("CLEAR OFF SELESAI", h(slotName(st.slot)), res));
}

async function scanAndAsk(ctx, slot) {
  const uid = ctx.from.id;
  const wait = await replyNote(ctx, "⏳", `Memeriksa status server ${h(slotName(slot))}...`, "Ini bisa memakan waktu untuk panel yang besar.");
  const edit = (rich, rows) => editView(ctx.telegram, wait.chat.id, wait.message_id, rich, rows).catch(() => {});
  try {
    const r = await scanOffline(slot, (n, t) => edit(note("⏳", `Memeriksa status server ${h(slotName(slot))}...`, `${n}/${t}`)));
    if (r.error) return edit(note("✕", "Gagal memeriksa panel", h(r.error)));
    if (!r.offline.length && !r.users.length) {
      return edit(note("✅", `Tidak ada yang perlu dibersihkan di ${h(slotName(slot))}`, `Total server: ${r.total}${r.unknown ? ` • status tidak terbaca: ${r.unknown}` : ""}`));
    }
    const tok = newToken();
    const st = { uid, slot, chatId: wait.chat.id, messageId: wait.message_id, servers: r.offline, users: r.users };
    st.timer = setTimeout(() => {
      if (!pending.delete(tok)) return;
      edit(note("⌛", "Konfirmasi kedaluwarsa", "Jalankan perintah clear off lagi."));
    }, CONFIRM_TTL_MS);
    pending.set(tok, st);
    await edit(
      title("⚠️", `Clear Off — ${h(slotName(slot))}`) +
        table(["Ringkasan", "Jumlah"], [
          ["Total server", String(r.total)],
          ["Suspend (dilewati)", String(r.skipped)],
          ...(r.unknown ? [["Status tidak terbaca (dilewati)", String(r.unknown)]] : []),
          ["Server offline", `<b>${r.offline.length}</b>`],
          ["User tanpa server (non-admin)", `<b>${r.users.length}</b>`],
        ]) +
        previewTable("Server offline", r.offline, (x) => [h(x.name), `<code>${x.id}</code>`]) +
        previewTable("User tanpa server", r.users, (x) => [h(x.username), `<code>${x.id}</code>`]) +
        quote("Penghapusan <b>tidak bisa dibatalkan</b>. Lanjutkan?"),
      [[{ text: "Hapus Semua", icon_custom_emoji_id: "6129486856212979482", emoji_fallback: "🗑", callback_data: `clroff:ok:${tok}` }, { text: "× Batal", callback_data: `clroff:x:${tok}` }]]
    );
  } catch (e) {
    console.error("[CLEAROFF] scan:", e);
    edit(note("✕", "Terjadi kesalahan", "Gagal memeriksa panel."));
  } finally {
    running.delete(slot);
  }
}

registerCallback("clroff", async (ctx, [action, tok]) => {
  const st = pending.get(tok);
  if (!st) return ctx.answerCbQuery("Konfirmasi sudah kedaluwarsa. Jalankan perintah lagi.", { show_alert: true });
  if (ctx.from.id !== st.uid) return ctx.answerCbQuery("Tombol ini bukan milik kamu.", { show_alert: true });
  if (!isStaff(ctx.from.id)) return ctx.answerCbQuery("Akses ditolak.", { show_alert: true });

  clearTimeout(st.timer);
  pending.delete(tok);
  if (action === "x") {
    await ctx.answerCbQuery("Dibatalkan.").catch(() => {});
    return editCbView(ctx, note("×", "Clear off dibatalkan", "Tidak ada yang dihapus.")).catch(() => {});
  }
  if (action !== "ok") return ctx.answerCbQuery().catch(() => {});
  if (running.has(st.slot)) return ctx.answerCbQuery("Panel ini sedang diproses.", { show_alert: true });

  running.add(st.slot);
  await ctx.answerCbQuery("Memulai penghapusan...").catch(() => {});
  await editCbView(ctx, note("⏳", "Menghapus...", `${st.servers.length} server &amp; ${st.users.length} user`)).catch(() => {});
  // background: handler Telegraf punya batas waktu 90 detik
  execute(ctx.telegram, st).finally(() => running.delete(st.slot));
});

export default {
  command: ["clearoff"],
  hiddenCommands: hidden,
  category: "cpanel",
  description: "Hapus semua server offline & user tanpa server (Owner+, ada konfirmasi). Contoh: /clearoff atau /clearoff2 (panel V2)",
  cooldown: 5000,
  run: async (ctx) => {
    if (!isStaff(ctx.from.id)) return replyView(ctx, STAFF_DENY);
    const m = cmdName(ctx).match(/^clearoff(\d+)?$/);
    if (!m) return;
    const slot = m[1] || getActiveSlot();
    if (!getPanel(slot)) return replyNote(ctx, "✕", `${h(slotName(slot))} belum dikonfigurasi`, `Atur lewat <code>${config.prefix}setpanel</code>.`);
    if (running.has(slot)) return replyNote(ctx, "⏳", "Sedang diproses", "Panel ini sedang diperiksa / dibersihkan.");
    running.add(slot);
    // background: scan panel besar bisa lebih dari 90 detik
    scanAndAsk(ctx, slot);
  },
};

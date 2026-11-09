// ═══════════════════════════════════════════════════════════════════════
// RICH UI — helper tampilan Rich Message (Bot API 10.1+) untuk fitur Cpanel, CVPS & Jadi Bot.
//  • Cukup tulis HTML rich (<h1> <p> <table> <blockquote> <details> ...); versi HTML biasa
//    (cadangan bila server menolak Rich Message) dibuat otomatis oleh toLegacy().
//  • Semua tombol (rows = array baris tombol) otomatis diwarnai & beranimasi biru -> merah -> hijau,
//    sama seperti tombol menu utama.
// ═══════════════════════════════════════════════════════════════════════
import { sendRich, editRich, h, richTable } from "./rich.js";
import { paint, startAnim, stopAnim, stopAnimFor } from "./btnAnim.js";

export { h, stopAnimFor };

// ---------- Pembangun HTML rich ----------
/** Judul besar: title("🖥️", "CPanel") */
export const title = (icon, text) => `<h1>${icon ? icon + " " : ""}${text}</h1>`;
export const sub = (icon, text) => `<h2>${icon ? icon + " " : ""}${text}</h2>`;
/** Paragraf; beberapa argumen digabung dengan baris baru */
export const para = (...lines) => `<p>${lines.flat().join("<br>")}</p>`;
/** Kutipan (blockquote) */
export const quote = (...lines) => `<blockquote>${lines.flat().join("<br>")}</blockquote>`;
/** Kartu pesan singkat: ikon + judul tebal + isi */
export const note = (icon, text, body = "") => quote(`${icon} <b>${text}</b>${body ? "<br>" + body : ""}`);
/** Tabel asli: table(["Info","Nilai"], [["a","b"], ...]) — isi sel harus sudah di-escape (pakai h()) */
export const table = (head, rows) => richTable(head, rows);
/** Blok lipat */
export const fold = (summary, ...body) => `<details><summary>${summary}</summary><p>${body.flat().join("<br>")}</p></details>`;
/** Daftar poin */
export const bullets = (items) => para(items.map((x) => `• ${x}`));

// ---------- Rich -> HTML biasa (cadangan) ----------
export function toLegacy(html = "") {
  return String(html)
    .replace(/<img[^>]*>/gi, "")
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "<b>$1</b>\n")
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "<b>$1</b>\n")
    .replace(/<\/?details[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, "<td><b>$1</b></td>")
    .replace(/<\/td>\s*<td[^>]*>/gi, " — ")
    .replace(/<tr[^>]*>\s*<td[^>]*>/gi, "")
    .replace(/<\/td>\s*<\/tr>/gi, "\n")
    .replace(/<\/?(table|tbody|thead)[^>]*>/gi, "")
    .replace(/<\/blockquote>\s*\n+/gi, "</blockquote>\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const asView = (rich) => ({ rich, legacy: toLegacy(rich) });
const kbd = (rows) => (rows?.length ? { inline_keyboard: rows } : undefined);

// ---------- Kirim / edit ----------
/** Kirim pesan rich. rows = baris tombol (opsional). extra = { reply_parameters, message_thread_id } */
export async function sendView(telegram, chatId, rich, rows, extra = {}) {
  const markup = kbd(rows);
  const sent = await sendRich(telegram, chatId, asView(rich), { ...(markup ? { reply_markup: paint(markup, 0) } : {}), ...extra });
  if (markup && sent) startAnim(telegram, sent.chat?.id ?? chatId, sent.message_id, markup);
  return sent;
}

/** Balas pesan perintah user dengan rich (+ tombol berwarna) */
export function replyView(ctx, rich, rows, extra = {}) {
  const m = ctx.message;
  return sendView(ctx.telegram, ctx.chat.id, rich, rows, {
    ...(m?.message_id ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } } : {}),
    ...(m?.message_thread_id ? { message_thread_id: m.message_thread_id } : {}),
    ...extra,
  });
}
/** Balas dengan kartu singkat: replyNote(ctx, "❌", "Akses ditolak", "Khusus owner.") */
export const replyNote = (ctx, icon, text, body = "", rows) => replyView(ctx, note(icon, text, body), rows);

/** Edit pesan jadi rich baru. Tanpa rows -> tombol dihapus & animasi berhenti. */
export async function editView(telegram, chatId, messageId, rich, rows) {
  const markup = kbd(rows);
  stopAnimFor(chatId, messageId);
  await editRich(telegram, chatId, messageId, asView(rich), markup ? paint(markup, 0) : undefined);
  if (markup) startAnim(telegram, chatId, messageId, markup);
}

/** Edit pesan tempat tombol callback ditekan */
export function editCbView(ctx, rich, rows) {
  const m = ctx.callbackQuery?.message;
  if (!m) return sendView(ctx.telegram, ctx.chat.id, rich, rows);
  return editView(ctx.telegram, m.chat.id, m.message_id, rich, rows);
}

/** Hentikan animasi pesan callback (panggil sebelum menghapus pesan) */
export function dropAnim(ctx) {
  const m = ctx.callbackQuery?.message;
  if (m) stopAnimFor(m.chat.id, m.message_id);
}

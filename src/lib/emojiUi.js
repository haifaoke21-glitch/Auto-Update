// ═══════════════════════════════════════════════════════════════════════
// EMOJI UI — helper TG emoji eksplisit untuk fitur yang ditulis dengan Rich Message (Build Menu, Update, dst).
//
//   tgE("✅")                     -> <tg-emoji emoji-id="ID">✅</tg-emoji>   (emoji biasa bila belum terdaftar)
//   iconBtn("⬇️", "Update", {callback_data})  -> tombol dengan ikon premium + emoji_fallback
//   iconRows(rows)               -> semua tombol berawalan emoji dijadikan ikon premium (+ emoji_fallback)
//   tgHtml(html)                 -> semua emoji di teks HTML/Rich dibungkus <tg-emoji>
//
// Pemilik bot TIDAK premium: lapisan lib/premiumEmoji.js otomatis mengembalikan semuanya jadi emoji biasa
// (<tg-emoji> -> emoji, ikon tombol -> emoji_fallback di depan teks tombol), jadi emoji tidak pernah hilang.
// ═══════════════════════════════════════════════════════════════════════
import { htmlEmoji, emojiId } from "./premiumEmoji.js";

const LEAD_RE = /^(\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}[\uFE0F]?)*)\s*([\s\S]*)$/u;

/** Satu emoji -> <tg-emoji> (atau emoji biasa kalau belum punya ID) */
export function tgE(emoji) {
  const id = emojiId(emoji);
  return id ? `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>` : emoji;
}

/** Semua emoji di teks HTML / Rich dibungkus <tg-emoji> (kode & tag yang sudah ada tidak disentuh) */
export const tgHtml = (html) => htmlEmoji(html);

/** Tombol dengan ikon premium; tanpa ID -> emoji biasa di depan teks. */
export function iconBtn(emoji, text, extra = {}) {
  const id = emojiId(emoji);
  return id ? { text, icon_custom_emoji_id: id, emoji_fallback: emoji, ...extra } : { text: `${emoji} ${text}`.trim(), ...extra };
}

/** Tombol berawalan emoji ("🐞 Debug") -> ikon premium + emoji_fallback. Tombol yang sudah punya ikon dibiarkan. */
export function iconButton(b) {
  if (!b || typeof b !== "object" || b.icon_custom_emoji_id || typeof b.text !== "string") return b;
  const m = LEAD_RE.exec(b.text);
  if (!m || !m[2].trim()) return b;
  const id = emojiId(m[1]);
  return id ? { ...b, text: m[2].trim(), icon_custom_emoji_id: id, emoji_fallback: m[1] } : b;
}

export const iconRows = (rows) => (Array.isArray(rows) ? rows.map((row) => (Array.isArray(row) ? row.map(iconButton) : row)) : rows);

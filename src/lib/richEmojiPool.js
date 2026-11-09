import config from '../../config.js';
import { emojiMap, richEmojis } from '../../data/EmojiPrem By @AboutAzmi.js';

const stripVs = (s) => String(s || '').replace(/\uFE0F/g, '');
// ID emoji: kalau emoji-nya ada di emojiMap (data/EmojiPrem), pakai ID itu; kalau belum, pakai id slot.
const DATA_IDS = new Map(Object.entries(emojiMap).map(([k, v]) => [stripVs(k), String(Array.isArray(v) ? v[0] : v)]));
const idFor = (e) => DATA_IDS.get(stripVs(e.emoji)) || String(e.id == null ? '' : e.id).trim();

// ═══════════════════════════════════════════════════════════════════════
// POOL EMOJI PREMIUM buat Rich Message (.buildrich / .autorich).
//
// Daftar emojinya ada di data/EmojiPrem By @AboutAzmi.js -> richEmojis (maks 99 slot):
//   { id: "5789410873269292841", emoji: "✨", label: "judul utama, highlight" }
//   - id    = ID emoji premium (ambil pake /idprem). Kosong = slot dilewatin.
//   - emoji = emoji biasa cadangan (kalau akun gak Premium / gagal render).
//   - label = arti/kegunaan emoji itu; dipake AI & pencocokan otomatis ke judul.
//
// Tiap slot punya KODE tetap sesuai nomor slotnya: {E1} ... {E99}.
//   - AI (.autorich) disuruh nulis KODE ini, bukan ID panjangnya (ID 19 digit
//     rawan salah ketik). expandAliases() ngubah {E3} -> {ID|emoji} sebelum parse.
//   - Di .buildrich manual, kode {E3} juga bisa diketik langsung.
//   - autoDecorate() ngasih emoji premium ke judul (H / BH / BQH / EX) yang belum
//     punya, dicocokin sama label, jadi TIAP build pasti ada emoji premiumnya.
// Matiin auto-tempel: config.rich.autoPremiumEmoji = false di settings.js.
// ═══════════════════════════════════════════════════════════════════════

const MAX_SLOTS = 99; // alias {E1}..{E99} (regex expandAliases: 1-2 digit)
const MAX_AUTO = 8; // maksimal judul yang ditempelin emoji otomatis per build

function cleanFallback(emoji) {
  const c = String(emoji == null ? '' : emoji).replace(/[{}|<>&\s]/g, '');
  return c || '⭐';
}

// Slot valid aja (id angka >= 5 digit). Alias = nomor slot (stabil walau ada slot kosong).
function getPool() {
  const src = Array.isArray(richEmojis) && richEmojis.length ? richEmojis : (config.premiumEmojis ?? config.rich?.premiumEmojis);
  const raw = Array.isArray(src) ? src.slice(0, MAX_SLOTS) : [];
  const pool = [];
  raw.forEach((e, idx) => {
    if (!e) return;
    const id = idFor(e);
    if (!/^\d{5,}$/.test(id)) return;
    pool.push({
      alias: `E${idx + 1}`,
      id,
      emoji: cleanFallback(e.emoji),
      label: String(e.label || '').trim(),
    });
  });
  return pool;
}

const markerOf = (e) => `{${e.id}|${e.emoji}}`;
const MARKER_RE = /\{\d{5,}\|[^{}|]+\}/;

// {E3} -> {ID|emoji}. Kode gak dikenal (slot kosong / nomor ngaco) dibuang.
function expandAliases(text) {
  const pool = getPool();
  return String(text == null ? '' : text).replace(/\{[Ee](\d{1,2})\}/g, (_, n) => {
    const hit = pool.find((e) => e.alias === `E${Number(n)}`);
    return hit ? markerOf(hit) : '';
  }).replace(/(\()[ \t]+/g, '$1');
}

// Potongan buat ditempel ke system prompt .autorich. Kosong kalau pool kosong.
function promptSection() {
  const pool = getPool();
  if (!pool.length) return '';
  const lines = [
    '',
    '=== EMOJI PREMIUM (WAJIB DIPAKAI) ===',
    `Kamu punya ${pool.length} emoji premium. Tulis pake KODE-nya persis (huruf E besar + nomor, dalam kurung kurawal). JANGAN nulis ID/angka panjang. Daftar:`,
    ...pool.map((e) => `{${e.alias}} = ${e.emoji}${e.label ? ' ' + e.label : ''}`),
    'Cara pake (1 emoji per posisi, kode BEDA-BEDA, dipilih sesuai ARTI/label-nya):',
    '- Posisi: judul H(..), ringkasan, paragraf deskripsi pertama, judul tabel T(..), tiap baris tabel (awal sel pertama, maks 8), tiap judul EX(..) (maks 5), BQ(..), dan F(..).',
    '- Emoji premium MENGGANTIKAN emoji biasa (🌴 ✅ dst) - JANGAN pake emoji biasa di posisi-posisi itu, termasuk yang ada di CONTOH di atas.',
    '- Total sekitar 8-18 emoji per pesan sesuai panjangnya. JANGAN taruh emoji di tiap kata atau tiap item list, dan JANGAN nutup tiap kalimat dengan emoji.',
    '- Hindari pengulangan: usahain tiap kode cuma dipake sekali. Kalau posisinya lebih banyak dari jumlah kode, baru boleh diulang, tapi jangan dua kali berdekatan.',
    '- Contoh: H({E1} Judul)   ({E9} Basic)(Rp 25.000)   EX({E4} Tips)',
    '- JANGAN taruh kode emoji premium di dalam CD(..) / P(..), di teks tombol B(..), atau di bagian link. JANGAN nulis <tg-emoji>, emoji-id, atau ID panjang - pake kode {E..} aja.',
  ];
  return lines.join('\n');
}

// Cocokin judul ke emoji: skor = jumlah kata label yang nongol di teks judul; seri -> yang paling jarang dipake.
function pick(pool, text, usage, lastId) {
  const t = String(text || '').toLowerCase();
  const scored = pool.map((e) => {
    const words = e.label.toLowerCase().split(/[\s,;/]+/).filter((w) => w.length >= 3);
    const score = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    return { e, score, used: usage.get(e.id) || 0 };
  });
  scored.sort((a, b) => b.score - a.score || a.used - b.used);
  const best = scored[0].score;
  const cands = scored.filter((x) => x.score === best && x.used === scored.find((y) => y.score === best).used);
  const choice = cands.find((x) => x.e.id !== lastId) || cands[0];
  return choice.e;
}

const HEADING_RE = /^(BQH|BH|H|EX)\((.+)\)\s*$/;
// emoji biasa di awal judul (termasuk VS16/ZWJ/skin tone) + spasi sesudahnya
const LEADING_EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}])*)+\s*/u;

/**
 * Tempelin emoji premium ke judul yang belum punya (H / BH / BQH / EX).
 * @param {string} markup
 * @param {{ onlyIfNone?: boolean }} [opts] onlyIfNone: kalau markup UDAH ada emoji premium
 *        (diketik sendiri / dari AI) jangan diapa-apain (dipake .buildrich manual).
 */
function autoDecorate(markup, opts = {}) {
  const text = String(markup == null ? '' : markup);
  if (config.rich?.autoPremiumEmoji === false) return text;
  const pool = getPool();
  if (!pool.length) return text;
  if (opts.onlyIfNone && MARKER_RE.test(text)) return text;

  const usage = new Map();
  for (const m of text.matchAll(/\{(\d{5,})\|[^{}|]+\}/g)) usage.set(m[1], (usage.get(m[1]) || 0) + 1);

  const lines = text.split('\n');
  let added = 0;
  let lastId = null;
  for (let i = 0; i < lines.length && added < MAX_AUTO; i++) {
    const line = lines[i].trim();
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const content = m[2].trim();
    if (/^\{\d{5,}\|[^{}|]+\}/.test(content)) { lastId = null; continue; } // udah premium
    const plain = content.replace(LEADING_EMOJI_RE, '');
    if (!plain) continue;
    const e = pick(pool, plain, usage, lastId);
    usage.set(e.id, (usage.get(e.id) || 0) + 1);
    lastId = e.id;
    lines[i] = `${m[1]}(${markerOf(e)} ${plain})`;
    added++;
  }
  return lines.join('\n');
}

export { getPool, expandAliases, promptSection, autoDecorate };

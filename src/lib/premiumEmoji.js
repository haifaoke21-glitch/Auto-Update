// ═══════════════════════════════════════════════════════════════════════
// PREMIUM EMOJI — semua emoji biasa yang ada di daftar data/EmojiPrem By @AboutAzmi.js otomatis
// dikirim sebagai emoji premium (custom emoji), di MANA PUN dia muncul:
//   • teks pesan & caption (HTML, Markdown lama, maupun teks polos)
//   • Rich Message (html / markdown / blocks)
//   • tombol inline & tombol keyboard (lewat icon_custom_emoji_id, Bot API 9.4+)
//
// Pemasangan: installPremiumEmoji(bot) dipanggil sekali di registerHandlers() (bot utama + clone).
// Jadi plugin lama TIDAK perlu diubah: tulis emoji biasa saja seperti sebelumnya.
//
// Catatan Telegram: emoji premium dari bot hanya tampil kalau pemilik bot punya Telegram Premium.
// Kalau tidak, yang tampil emoji biasanya (tidak error). Kalau Telegram menolak payload hasil konversi,
// pesan otomatis dikirim ulang dalam bentuk aslinya, jadi tidak ada pesan yang hilang.
//
// Matikan total: config.premiumEmoji = false di config.js.
// Ubah / tambah emoji: edit data/EmojiPrem By @AboutAzmi.js  { "😀": "ID_EMOJI_PREMIUM" }.
// ═══════════════════════════════════════════════════════════════════════
import config from "../../config.js";

import { emojiMap as rawEmojiMap, emojiAll as rawEmojiAll, richEmojis } from "../../data/EmojiPrem By @AboutAzmi.js";
const MAX_ENT = 90; // batas Telegram 100 entity per pesan, sisakan ruang

// Emoji yang belum ada di JSON tapi artinya sama dengan emoji yang ada -> pakai ID emoji itu.
// Tambah/hapus bebas. Format: "emoji yang dipakai di kode": "emoji di EmojiPrem By @AboutAzmi.js".
const ALIASES = {
  "🔙": "⬅️", "◀️": "⬅️", "⌛": "⏳", "❗": "⚠️", "❕": "ℹ️", "⛔": "🚫", "✔️": "✅", "☑️": "✅",
  "⏰": "⏱️", "📩": "📧", "📨": "📧", "✉️": "📧", "🔔": "📢", "💿": "💽",
  "🛠️": "⚙️", "🧰": "⚙️", "⚒️": "⚙️", "❓": "❔",
  "🪙": "💰",
  "🆕": "✨", "📭": "📧", "🧹": "🗑️", "📷": "🎨", "🎬": "▶️", "💡": "✨", "📍": "📌",
  "🤝": "👤", "👨‍💻": "👤", "🧑‍💻": "👤", "📱": "📲", "📅": "⏱️", "🔌": "⚙️",
  "📚": "📖", "📋": "📖", "🏆": "🎖️", "🥇": "🎖️", "🔱": "👑", "👍": "✅", "👌": "✅", "🏁": "✅",
  "🆓": "🎁", "✍️": "✏️", "⌨️": "💻", "🧮": "🔢", "↩️": "⬅️",
  "💝": "❤️", "💘": "❤️", "🖤": "❤️", "🧡": "❤️", "💗": "❤️", "💖": "❤️",
  "😅": "😹", "😁": "😹", "🤭": "😹", "🔮": "✨",
  "☁️": "🌐", "♻️": "🔄", "🐍": "💻",
  // Mapping tambahan yang lebih tepat (hanya ke emoji yang ada di daftar)
  "👥": "👤", "🖼️": "🎨", "✖️": "❌", "🖥️": "💻", "🎭": "🎮",
  "📂": "📥", "🔧": "⚙️", "🔎": "🔍", "⬅️": "🔙", "◀️": "🔙",
  // V2.5 — emoji yang masih tampil biasa dipetakan ke emoji premium terdekat (artinya mirip)
  "🧩": "💠", "📄": "📖", "📜": "📖", "🔨": "⚙️", "🟡": "🔸", "🟦": "🔵", "🟪": "🔵", "🟩": "🟢", "▫️": "🔹", "▪️": "🔹", "📏": "🧭",
  "🕒": "🕐", "🔊": "🔈", "🕌": "🌛", "🕋": "🌛", "🌙": "🌛", "🌃": "🌛", "🌇": "🌤", "🌅": "☀️", "🌄": "☀️", "🌡": "🌤", "💨": "🌀", "🌴": "🌤",
  "🎯": "🏅", "🏳️": "🚩", "🎌": "🚩", "🏓": "🎮", "🎲": "🎮", "🎰": "🎮", "🥚": "💫", "🔁": "🔄", "👢": "🚫", "🔓": "🔒",
  "🐞": "👾", "🪲": "👾", "🧟": "👻", "💙": "❤️", "💜": "❤️", "💔": "❤️", "📡": "📶", "🥰": "😍", "😈": "👿", "🔪": "🗡",
  "📁": "📥", "⏹️": "⏺️", "⏭️": "🔜", "🥺": "🥹", "🛌": "😴", "🥱": "😴", "🍀": "🌟", "🎂": "🎉", "🎀": "🎁", "😇": "🙂", "🧘": "🙂",
  "⚖️": "🏦", "☯️": "💠", "🍜": "🍽", "🍥": "🍽", "🙈": "🫣", "🫢": "🫣", "💪": "🔥", "💍": "💎", "😤": "😑", "😢": "😭",
  "👨‍👩‍👧‍👦": "👤", "📛": "🪪", "👏": "👍", "🗄️": "💾", "🗂": "🗃", "🗂️": "🗃", "❔": "❓",
};
// ID tambahan untuk emoji yang BELUM ada di data/EmojiPrem By @AboutAzmi.js tapi ID-nya sudah dipakai di bot ini
// (richEmojis di data/EmojiPrem + daftar di lib/emo.js). Hanya mengisi yang kosong: ID dari file EmojiPrem selalu diprioritaskan.
const EXTRA_IDS = {
  "⏳": "5454415424319931791", "📝": "5334882760735598374", "🔑": "5330115548900501467",
  "📦": "5319109106793986870", "🆔": "5422439311196834318", "🏷️": "6202001327397020033", "🏠": "5416041192905265756",
  "🛒": "5431499171045581032", "🔐": "6129731845442510016", "📂": "5431721976769027887",
  "⏱️": "5969545478155539601", "🔖": "5222444124698853913", "🔢": "5402477260982731644", "📊": "5231200819986047254",
  "💽": "5463107823946717464", "📧": "5372825386591732174", "📲": "6093587384954262033", "🧾": "5334882760735598374",
  "🏛️": "6204072077159309131", "🛡️": "6204072077159309131", "🖥️": "5282843764451195532", "🤖": "5287684458881756303",
  "🎖️": "6156436440260549720", "🚨": "5395695537687123235", "😹": "6093522689861882360", "⚔️": "5454014806950429357",
  "🐆": "6087079590377820415", "🤬": "6123030506754805624", "🗃️": "5188540541922480562", "💬": "5443038326535759644",
  "📢": "5215668805199473901", "👋": "6095851644468072524", "💋": "6096153219891728680", "🔇": "5213391561999526028",
  "⚡": "6095843123252957701", "🌐": "5447410659077661506", "✏️": "5395444784611480792", "➡️": "5416117059207572332",
  "➕": "5397916757333654639", "➖": "6222263720379165715", "💼": "5445221832074483553", "☁️": "6073395072953485376",
  "👨‍💻": "5967763324425736076",
};
// Tidak diganti walaupun ada di JSON (mis. © di teks hak cipta jangan jadi centang).
const EXCLUDE = new Set(["©"]);

const strip = (s) => s.replace(/️/g, "");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ID cadangan untuk emoji yang belum terdaftar (config.premiumEmojiFallback / premiumEmojiFallbackId).
const FALLBACK_ID = config.premiumEmojiFallback !== false && /^\d{5,}$/.test(String(config.premiumEmojiFallbackId || "")) ? String(config.premiumEmojiFallbackId) : null;
// Tidak diganti oleh cadangan: © ® ™ (simbol teks) dan ✊ ✋ ✂ 🪨 (isi permainan suit).
const FALLBACK_SKIP = "©®™✊✋✂🪨";

// ID cadangan khusus tombol (config.premiumButtonFallbackId, default = premiumEmojiFallbackId). Set premiumButtonFallback: false untuk mematikan.
const BTN_FALLBACK_ID = config.premiumButtonFallback !== false && /^\d{5,}$/.test(String(config.premiumButtonFallbackId || config.premiumEmojiFallbackId || "")) ? String(config.premiumButtonFallbackId || config.premiumEmojiFallbackId) : null;
let BTN_SRC = null;
let LEAD_RE = null;
let ids = new Map(); // emoji tanpa FE0F -> id
let rev = new Map(); // id -> emoji biasa (dipakai mengembalikan ikon tombol saat pemilik bot tidak premium)
let SRC = null; // sumber regex pencocok emoji
let TEST_RE = null;

function load() {
  let raw = rawEmojiMap || {};
  const base = new Map();
  rev = new Map();
  for (const [k, v] of Object.entries(raw)) {
    const id = String(v || "").trim();
    if (/^\d{5,}$/.test(id) && !EXCLUDE.has(strip(k))) {
      base.set(strip(k), id);
      if (!rev.has(id) && ![...k].some((ch) => ch === "⃣" || /\p{Regional_Indicator}/u.test(ch))) rev.set(id, k);
    }
  }
  // Isi celah dari EXTRA_IDS + richEmojis (tidak menimpa ID dari file EmojiPrem).
  const addExtra = (emoji, idRaw) => {
    const id = String(idRaw || "").trim();
    const key = strip(String(emoji || ""));
    if (!key || !/^\d{5,}$/.test(id) || EXCLUDE.has(key) || base.has(key)) return;
    base.set(key, id);
    if (!rev.has(id)) rev.set(id, emoji);
  };
  for (const [e, id] of Object.entries(EXTRA_IDS)) addExtra(e, id);
  for (const it of Array.isArray(richEmojis) ? richEmojis : []) addExtra(it?.emoji, it?.id);
  for (const [alias, target] of Object.entries(ALIASES)) {
    const key = strip(alias);
    if (!base.has(key) && base.has(strip(target))) base.set(key, base.get(strip(target)));
  }
  ids = base;
  const keys = [...ids.keys()].sort((a, b) => [...b].length - [...a].length);
  // tiap code point boleh diikuti FE0F; jangan cocok kalau bagian dari urutan ZWJ / skin tone
  const mapped = keys.length
    ? "(?<![\\u200D])(?:" + keys.map((k) => [...k].map((ch) => escRe(ch) + "\\uFE0F?").join("")).join("|") + ")(?![\\u200D\\u{1F3FB}-\\u{1F3FF}])"
    : null;
  // Cadangan: emoji apa pun yang belum terdaftar (urutan ZWJ / skin tone ikut satu kesatuan).
  const generic = FALLBACK_ID
    ? "(?<![\\u200D])(?![" + [...FALLBACK_SKIP].join("") + "])\\p{Extended_Pictographic}[\\uFE0F\\u{1F3FB}-\\u{1F3FF}]?(?:\\u200D\\p{Extended_Pictographic}[\\uFE0F\\u{1F3FB}-\\u{1F3FF}]?)*"
    : null;
  SRC = [mapped, generic].filter(Boolean).join("|") || null;
  if (SRC && mapped && generic) SRC = "(?:" + SRC + ")";
  TEST_RE = SRC ? new RegExp(SRC, "u") : null;
  // Tombol: SEMUA emoji dijadikan ikon tombol (yang belum terdaftar memakai ID cadangan tombol), terlepas dari premiumEmojiFallback teks.
  const btnGeneric = BTN_FALLBACK_ID
    ? "(?<![\\u200D])(?![" + [...FALLBACK_SKIP].join("") + "])\\p{Extended_Pictographic}[\\uFE0F\\u{1F3FB}-\\u{1F3FF}]?(?:\\u200D\\p{Extended_Pictographic}[\\uFE0F\\u{1F3FB}-\\u{1F3FF}]?)*"
    : null;
  BTN_SRC = [mapped, btnGeneric].filter(Boolean).join("|") || null;
  if (BTN_SRC && mapped && btnGeneric) BTN_SRC = "(?:" + BTN_SRC + ")";
}
load();

// ID "resmi" = semua ID di data/EmojiPrem By @AboutAzmi.js (emojiMap, emojiAll, dan slot richEmojis yang emoji-nya belum ada di emojiMap).
// <tg-emoji> / ikon tombol yang ditulis manual di plugin dengan ID di luar daftar ini (ID lama / salah, mis. 📋 yang tampil 😭)
// otomatis diganti dengan ID emoji yang sama dari daftar di atas.
const AUTH = new Set();
for (const v of Object.values(rawEmojiMap || {})) AUTH.add(String(v));
for (const arr of Object.values(rawEmojiAll || {})) for (const v of [].concat(arr)) AUTH.add(String(v));
for (const it of Array.isArray(richEmojis) ? richEmojis : []) {
  if (it && !(rawEmojiMap && Object.keys(rawEmojiMap).some((k) => strip(k) === strip(String(it.emoji || ""))))) AUTH.add(String(it.id || ""));
}
const fixId = (id, emoji) => {
  if (AUTH.has(String(id))) return id;
  return ids.get(strip(String(emoji || "").trim())) || id;
};
const TG_TAG_RE = /<tg-emoji\s+emoji-id="(\d+)"\s*>([^<]*)<\/tg-emoji>/gi;
const normalizeTags = (html) => html.replace(TG_TAG_RE, (m, id, e) => { const n = fixId(id, e); return n === id ? m : `<tg-emoji emoji-id="${n}">${e}</tg-emoji>`; });

const enabled = () => config.premiumEmoji !== false && !!SRC;
const idOf = (emoji) => ids.get(strip(emoji)) || FALLBACK_ID;
const newRe = (flags = "gu") => new RegExp(SRC, flags);
const isPlain = (v) => v && typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);

// ── HTML ────────────────────────────────────────────────────────────────
// Bungkus emoji di bagian teks (bukan di dalam tag / <code> / <pre> / <tg-emoji>) dengan <tg-emoji>.
export function htmlEmoji(html, budget = { n: MAX_ENT }) {
  if (!enabled() || typeof html !== "string" || !TEST_RE.test(html)) return html;
  const re = newRe();
  if (/<tg-emoji/i.test(html)) html = normalizeTags(html);
  const parts = html.split(/(<[^>]*>)/);
  let skip = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1) {
      const m = /^<\s*(\/?)\s*(pre|code|tg-emoji)\b/i.exec(p);
      if (m) skip += m[1] ? -1 : 1;
      if (skip < 0) skip = 0;
      continue;
    }
    if (skip > 0 || !p) continue;
    parts[i] = p.replace(re, (m) => (budget.n-- > 0 ? `<tg-emoji emoji-id="${idOf(m)}">${m}</tg-emoji>` : m));
  }
  return parts.join("");
}

// ── Markdown lama Telegram -> HTML ───────────────────────────────────────
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");

function nextUnescaped(src, ch, from) {
  for (let i = from; i < src.length; i++) {
    if (src[i] === "\\") { i++; continue; }
    if (src[i] === ch) return i;
  }
  return -1;
}

export function legacyMarkdownToHtml(src, noEmph = false) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && "_*`[".includes(src[i + 1])) { out += escHtml(src[i + 1]); i += 2; continue; }
    if (src.startsWith("```", i)) {
      const e = src.indexOf("```", i + 3);
      if (e > 0) {
        const body = src.slice(i + 3, e).replace(/^[A-Za-z0-9_+#-]*\n/, "");
        out += `<pre>${escHtml(body)}</pre>`; i = e + 3; continue;
      }
    }
    if (c === "`") {
      const e = src.indexOf("`", i + 1);
      if (e > 0) { out += `<code>${escHtml(src.slice(i + 1, e))}</code>`; i = e + 1; continue; }
    }
    if (!noEmph && (c === "*" || c === "_")) {
      const e = nextUnescaped(src, c, i + 1);
      if (e > i + 1) {
        const tag = c === "*" ? "b" : "i";
        out += `<${tag}>${legacyMarkdownToHtml(src.slice(i + 1, e), true)}</${tag}>`; i = e + 1; continue;
      }
    }
    if (c === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) { out += `<a href="${escAttr(m[2])}">${legacyMarkdownToHtml(m[1], true)}</a>`; i += m[0].length; continue; }
    }
    out += escHtml(c); i++;
  }
  return out;
}

// ── Teks polos: entity custom_emoji ───────────────────────────────────────
function plainEntities(text, entities, budget = { n: MAX_ENT }) {
  if (typeof text !== "string" || !TEST_RE.test(text)) return null;
  const existing = Array.isArray(entities) ? entities : [];
  const blocked = existing.filter((e) => e && (e.type === "pre" || e.type === "code" || e.type === "custom_emoji"));
  const add = [];
  for (const m of text.matchAll(newRe())) {
    if (budget.n <= 0) break;
    const start = m.index;
    const end = start + m[0].length;
    if (blocked.some((e) => start < e.offset + e.length && end > e.offset)) continue;
    add.push({ type: "custom_emoji", offset: start, length: m[0].length, custom_emoji_id: idOf(m[0]) });
    budget.n--;
  }
  if (!add.length) return null;
  return [...existing, ...add].sort((a, b) => a.offset - b.offset);
}

// ── Tombol ───────────────────────────────────────────────────────────────
const leadRe = () => (LEAD_RE ||= new RegExp("^(" + BTN_SRC + ")\\s*", "u"));
const btnId = (emoji) => ids.get(strip(emoji)) || BTN_FALLBACK_ID;

// Tombol yang sudah ditulis eksplisit di kode: { text, icon_custom_emoji_id, emoji_fallback }.
// emoji_fallback = emoji biasa untuk mode non-premium; field ini TIDAK ikut dikirim ke Telegram.
const dropFallback = (b) => { const { emoji_fallback: _f, ...rest } = b; return rest; };

// Tombol yang sudah punya ikon premium tidak boleh membawa emoji lagi di teksnya (hasilnya dobel: ikon + emoji).
const EDGE_EMOJI_RE = /^(?:\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?)*\s*)+|(?:\s*\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?)*)+$/gu;
function cleanIconText(b) {
  const clean = b.text.replace(EDGE_EMOJI_RE, "").trim();
  return clean && clean !== b.text ? { ...b, text: clean } : b; // tombol hanya berisi emoji dibiarkan (Telegram butuh teks)
}

function convButton(b) {
  if (b && typeof b === "object" && b.icon_custom_emoji_id && b.emoji_fallback) {
    const n = fixId(b.icon_custom_emoji_id, b.emoji_fallback);
    if (n !== b.icon_custom_emoji_id) b = { ...b, icon_custom_emoji_id: n };
  }
  if (b && typeof b === "object" && "emoji_fallback" in b) b = dropFallback(b);
  if (b && typeof b === "object" && typeof b.text === "string" && b.icon_custom_emoji_id) return cleanIconText(b);
  if (!b || typeof b !== "object" || typeof b.text !== "string" || b.icon_custom_emoji_id) return b;
  if (!BTN_SRC) return b;
  const m = leadRe().exec(b.text);
  if (m) {
    const rest = b.text.slice(m[0].length);
    if (!rest.trim()) return b; // tombol hanya berisi emoji (mis. papan game): biarkan
    return { ...b, text: rest, icon_custom_emoji_id: btnId(m[1]) };
  }
  // Emoji di akhir / tengah teks tombol ("Next ➡️", "Hal ▶️", "Pilih 🎮 Game"): ambil emoji pertama jadi ikon,
  // teksnya dibersihkan. (Telegram hanya mendukung SATU ikon per tombol; emoji lain tetap emoji biasa.)
  const any = new RegExp(BTN_SRC, "u").exec(b.text);
  if (!any) return b;
  const text = (b.text.slice(0, any.index) + " " + b.text.slice(any.index + any[0].length)).replace(/\s{2,}/g, " ").trim();
  if (!text) return b;
  return { ...b, text, icon_custom_emoji_id: btnId(any[0]) };
}

function convMarkup(rm) {
  if (!isPlain(rm)) return rm;
  let changed = false;
  const mapRows = (rows) => rows.map((row) => (Array.isArray(row) ? row.map((b) => { const n = convButton(b); if (n !== b) changed = true; return n; }) : row));
  const out = { ...rm };
  if (Array.isArray(out.inline_keyboard)) out.inline_keyboard = mapRows(out.inline_keyboard);
  if (Array.isArray(out.keyboard)) out.keyboard = mapRows(out.keyboard);
  return changed ? out : rm;
}

// Hanya buang emoji_fallback (tanpa mengubah emoji lain) — dipakai mode PERSIS.
function convMarkupKeep(rm) {
  if (!isPlain(rm)) return rm;
  let changed = false;
  const mapRows = (rows) => rows.map((row) => (Array.isArray(row) ? row.map((b) => { if (b && typeof b === "object" && "emoji_fallback" in b) { changed = true; return dropFallback(b); } return b; }) : row));
  const out = { ...rm };
  if (Array.isArray(out.inline_keyboard)) out.inline_keyboard = mapRows(out.inline_keyboard);
  if (Array.isArray(out.keyboard)) out.keyboard = mapRows(out.keyboard);
  return changed ? out : rm;
}

// ── Rich Message ─────────────────────────────────────────────────────────
// Potong teks polos jadi array RichText: [ "teks ", {custom_emoji}, " lanjut" ]
export function richParts(str) {
  if (!enabled() || typeof str !== "string" || !TEST_RE.test(str)) return str;
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(newRe())) {
    if (m.index > last) parts.push(str.slice(last, m.index));
    parts.push({ type: "custom_emoji", custom_emoji_id: idOf(m[0]), alternative_text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts;
}

export function richMarkdownEmoji(md) {
  if (!enabled() || typeof md !== "string" || !TEST_RE.test(md)) return md;
  const re = newRe();
  return md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((seg, i) => (i % 2 ? seg : seg.replace(re, (m) => `![${m}](tg://emoji?id=${idOf(m)})`))).join("");
}

// ── Satu panggilan Bot API ────────────────────────────────────────────────
const TEXT_METHODS = new Set(["sendMessage", "editMessageText", "sendMessageDraft"]);
const CAPTION_METHODS = new Set(["sendPhoto", "sendVideo", "sendDocument", "sendAudio", "sendVoice", "sendAnimation", "editMessageCaption", "copyMessage"]);

function convTextField(out, textKey, entKey) {
  const val = out[textKey];
  if (typeof val !== "string") return false;
  const mode = String(out.parse_mode || "");
  if (/^html$/i.test(mode)) {
    const n = htmlEmoji(val);
    if (n !== val) { out[textKey] = n; return true; }
    return false;
  }
  if (/^markdown$/i.test(mode)) {
    // Markdown lama tidak punya sintaks custom emoji -> ubah ke HTML lalu bungkus emoji
    if (!TEST_RE.test(val)) return false;
    out[textKey] = htmlEmoji(legacyMarkdownToHtml(val));
    out.parse_mode = "HTML";
    return true;
  }
  if (mode) return false; // MarkdownV2: biarkan apa adanya
  const ents = plainEntities(val, out[entKey]);
  if (!ents) return false;
  out[entKey] = ents;
  return true;
}

// ── Mode emoji BIASA (pemilik bot tidak premium) ─────────────────────────
// Kebalikan dari konversi di atas: semua <tg-emoji> / entity custom_emoji / ikon tombol dikembalikan jadi emoji biasa,
// termasuk <tg-emoji> yang ditulis manual di kode plugin.
const TG_EMOJI_RE = /<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi;
export const stripHtmlEmoji = (html) => (typeof html === "string" && /<tg-emoji/i.test(html) ? html.replace(TG_EMOJI_RE, "$1") : html);

function stripTextField(out, textKey, entKey) {
  let changed = false;
  const val = out[textKey];
  if (typeof val === "string" && /^html$/i.test(String(out.parse_mode || ""))) {
    const n = stripHtmlEmoji(val);
    if (n !== val) { out[textKey] = n; changed = true; }
  }
  if (Array.isArray(out[entKey]) && out[entKey].some((e) => e && e.type === "custom_emoji")) {
    out[entKey] = out[entKey].filter((e) => !e || e.type !== "custom_emoji"); // teksnya sudah berisi emoji biasa
    changed = true;
  }
  return changed;
}

// Emoji biasa pengganti ikon saat pemilik bot tidak premium. Urutan: emoji_fallback tombol -> daftar
// EmojiPrem By @AboutAzmi.js -> hasil getCustomEmojiStickers (cache) -> emoji umum terakhir, supaya ikon tidak pernah hilang.
// config.premiumPlainEmoji: emoji umum terakhir (default "🔹"; "" = jangan tambah apa pun).
const PLAIN_DEFAULT = typeof config.premiumPlainEmoji === "string" ? config.premiumPlainEmoji : "🔹";
const iconCache = new Map(); // id emoji premium -> emoji biasa (dari Telegram)
const iconMiss = new Set(); // id yang gagal dicari: jangan ditanya berulang-ulang
export const plainEmojiFor = (id) => rev.get(String(id)) || iconCache.get(String(id)) || PLAIN_DEFAULT;

/** ID ikon tombol yang belum diketahui emoji biasanya (tanpa emoji_fallback, tidak ada di JSON, belum di-cache) */
function unknownIconIds(rm) {
  const found = new Set();
  if (!isPlain(rm)) return found;
  for (const rows of [rm.inline_keyboard, rm.keyboard]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const b of row) {
        const id = b && typeof b === "object" && b.icon_custom_emoji_id ? String(b.icon_custom_emoji_id) : null;
        if (id && !b.emoji_fallback && !rev.has(id) && !iconCache.has(id) && !iconMiss.has(id)) found.add(id);
      }
    }
  }
  return found;
}

/** Tanya Telegram emoji biasa dari ID ikon yang tidak dikenal (getCustomEmojiStickers), simpan di cache. */
async function resolveIcons(call, rm) {
  const ids = [...unknownIconIds(rm)].slice(0, 200);
  if (!ids.length) return;
  try {
    const res = await call("getCustomEmojiStickers", { custom_emoji_ids: ids });
    for (const st of Array.isArray(res) ? res : []) {
      if (st?.custom_emoji_id && st.emoji) iconCache.set(String(st.custom_emoji_id), st.emoji);
    }
  } catch (e) {
    console.warn("[PREMIUM] gagal mencari emoji biasa untuk ikon tombol:", e?.message || e);
  }
  for (const id of ids) if (!iconCache.has(id)) iconMiss.add(id);
}

function stripButton(b) {
  if (!b || typeof b !== "object") return b;
  if (!b.icon_custom_emoji_id) return "emoji_fallback" in b ? dropFallback(b) : b;
  const { icon_custom_emoji_id: id, emoji_fallback: fb, ...rest } = b;
  const em = fb || plainEmojiFor(id);
  return em && !String(rest.text || "").includes(em) ? { ...rest, text: rest.text ? `${em} ${rest.text}` : em } : rest;
}

function stripMarkup(rm) {
  if (!isPlain(rm)) return rm;
  let changed = false;
  const mapRows = (rows) => rows.map((row) => (Array.isArray(row) ? row.map((b) => { const n = stripButton(b); if (n !== b) changed = true; return n; }) : row));
  const out = { ...rm };
  if (Array.isArray(out.inline_keyboard)) out.inline_keyboard = mapRows(out.inline_keyboard);
  if (Array.isArray(out.keyboard)) out.keyboard = mapRows(out.keyboard);
  return changed ? out : rm;
}

/**
 * Ubah payload satu panggilan Bot API.
 *  active = true  -> emoji biasa jadi emoji premium (tg-emoji / custom_emoji / ikon tombol)
 *  active = false -> kebalikannya: semua dikembalikan jadi emoji biasa (pemilik bot tidak premium)
 */
export function transformPayload(method, data, richFns, active = true) {
  if (!enabled() || !isPlain(data) || Array.isArray(data)) return data;
  const out = { ...data };
  let changed = false;
  const conv = active ? convTextField : stripTextField;
  const richFn = active ? richFns?.transformRichMessage : richFns?.stripRichMessage;
  const markupFn = active ? convMarkup : stripMarkup;

  if (TEXT_METHODS.has(method)) changed = conv(out, "text", "entities") || changed;
  if (CAPTION_METHODS.has(method)) changed = conv(out, "caption", "caption_entities") || changed;

  if (method === "sendMediaGroup" && Array.isArray(out.media)) {
    out.media = out.media.map((it) => {
      if (!isPlain(it)) return it;
      const c = { ...it };
      return conv(c, "caption", "caption_entities") ? (changed = true, c) : it;
    });
  }
  if (method === "editMessageMedia" && isPlain(out.media)) {
    const c = { ...out.media };
    if (conv(c, "caption", "caption_entities")) { out.media = c; changed = true; }
  }

  // Hasil inline query: teks pesan yang dikirim saat hasil dipilih
  if (method === "answerInlineQuery" && Array.isArray(out.results)) {
    out.results = out.results.map((r) => {
      const c = isPlain(r) && isPlain(r.input_message_content) ? { ...r.input_message_content } : null;
      if (!c) return r;
      let hit = conv(c, "message_text", "entities");
      if (isPlain(c.rich_message) && richFn) {
        const after = richFn(c.rich_message);
        if (after !== c.rich_message) { c.rich_message = after; hit = true; }
      }
      return hit ? (changed = true, { ...r, input_message_content: c }) : r;
    });
  }

  if (isPlain(out.rich_message) && richFn) {
    const before = out.rich_message;
    const after = richFn(before);
    if (after !== before) { out.rich_message = after; changed = true; }
  }

  if (out.reply_markup) {
    const rm = markupFn(out.reply_markup);
    if (rm !== out.reply_markup) { out.reply_markup = rm; changed = true; }
  }
  return changed ? out : data;
}

// ── Status Premium pemilik bot ───────────────────────────────────────────
// Telegram hanya menampilkan emoji premium dari bot kalau PEMILIK bot punya Telegram Premium.
// Status itu dipelajari dari update milik pemilik (field from.is_premium) oleh lib/ownerPremium.js,
// lalu disimpan di database, jadi tetap diingat setelah bot restart.
//   config.premiumEmojiOwner = "auto" (default) -> ikuti status pemilik; sebelum diketahui dianggap premium
//                              true / "on"      -> selalu emoji premium
//                              false / "off"    -> selalu emoji biasa
let ownerProvider = null;
/** fn(ownerIds: string[]) -> true (ada yang premium) | false (semua yang diketahui tidak premium) | null (belum diketahui) */
export const setOwnerPremiumProvider = (fn) => { ownerProvider = typeof fn === "function" ? fn : null; };

function premiumActive(tg) {
  const mode = config.premiumEmojiOwner;
  if (mode === true || mode === "on") return true;
  if (mode === false || mode === "off") return false;
  // Bot clone (Jadi Bot): selalu kirim emoji premium tanpa menunggu pemilik bot /start dulu.
  // Kalau Telegram tidak bisa menampilkannya, otomatis jadi emoji biasa (tidak error).
  if (tg.__alwaysPremium) return true;
  let st = null;
  try {
    st = ownerProvider ? ownerProvider(typeof tg.__premiumOwners === "function" ? tg.__premiumOwners() : []) : null;
  } catch (e) {
    console.warn("[PREMIUM] gagal cek status premium pemilik:", e.message);
  }
  return st === null ? true : st; // belum diketahui: coba emoji premium (Telegram otomatis menampilkan emoji biasa bila tidak bisa)
}

const RETRY_ERR = /parse entities|entit|emoji|icon|button|html|markdown|rich|unsupported|can't be parsed/i;
const NO_RETRY = /not modified|not found|chat not found|forbidden|blocked|rights|too many requests|can't be (edited|deleted)/i;

/** Pasang ke satu instance Telegraf (bot.telegram). Aman dipanggil berkali-kali. */
export function installPremiumEmoji(bot, richFns, { ownerIds, alwaysPremium = false } = {}) {
  const tg = bot?.telegram;
  if (!tg || tg.__premiumEmoji) return false;
  if (alwaysPremium) tg.__alwaysPremium = true;
  if (!enabled()) {
    // Emoji premium dimatikan: tombol yang ditulis eksplisit (icon_custom_emoji_id) dikembalikan jadi emoji biasa.
    const origOff = tg.callApi.bind(tg);
    tg.callApi = async function callApiOff(method, data, ...rest) {
      if (isPlain(data) && data.reply_markup) {
        const { exact_emoji: _x, ...d } = data;
        await resolveIcons(origOff, d.reply_markup);
        const rm = stripMarkup(d.reply_markup);
        return origOff(method, rm !== d.reply_markup ? { ...d, reply_markup: rm } : d, ...rest);
      }
      return origOff(method, data, ...rest);
    };
    tg.__premiumEmoji = true;
    return false;
  }
  if (typeof ownerIds === "function") tg.__premiumOwners = ownerIds;
  const orig = tg.callApi.bind(tg);
  tg.callApi = async function callApi(method, data, ...rest) {
    // Mode PERSIS (welcome / goodbye / filter dari pesan yang dibalas): emoji biasa TIDAK diganti emoji premium,
    // emoji premium & ikon tombol asli dikirim apa adanya. Penanda exact_emoji dibuang sebelum dikirim ke Telegram.
    if (data && typeof data === "object" && data.exact_emoji) {
      const { exact_emoji: _x, ...clean } = data;
      let exactNext = clean;
      if (!premiumActive(tg)) { // pemilik bot tidak premium: kembalikan ke emoji biasa seperti sebelumnya
        await resolveIcons(orig, clean.reply_markup);
        try { exactNext = transformPayload(method, clean, richFns, false); } catch { exactNext = clean; }
      } else if (clean.reply_markup) { // premium aktif: cukup buang field internal emoji_fallback dari tombol
        try {
          const rm = convMarkupKeep(clean.reply_markup);
          if (rm !== clean.reply_markup) exactNext = { ...clean, reply_markup: rm };
        } catch { /* kirim apa adanya */ }
      }
      return orig(method, exactNext, ...rest);
    }
    let next = data;
    try {
      const active = premiumActive(tg);
      if (!active && isPlain(data) && data.reply_markup) await resolveIcons(orig, data.reply_markup); // cari emoji biasa untuk ikon yang tak dikenal
      next = transformPayload(method, data, richFns, active);
    } catch (e) {
      console.error("[PREMIUM] gagal konversi, dikirim apa adanya:", e.message);
      next = data;
    }
    if (next === data) return orig(method, data, ...rest);
    try {
      return await orig(method, next, ...rest);
    } catch (e) {
      const msg = e?.response?.description || e?.message || "";
      if (e?.response?.error_code === 400 && RETRY_ERR.test(msg) && !NO_RETRY.test(msg)) {
        console.warn(`[PREMIUM] ${method} ditolak (${msg}); kirim ulang tanpa emoji premium.`);
        let plain = data;
        try { // versi emoji biasa (ikon tombol & emoji premium dikembalikan jadi emoji), bukan payload mentah
          if (isPlain(data) && data.reply_markup) await resolveIcons(orig, data.reply_markup);
          plain = transformPayload(method, data, richFns, false);
        } catch { plain = data; }
        return orig(method, plain, ...rest);
      }
      throw e;
    }
  };
  tg.__premiumEmoji = true;
  return true;
}

export const premiumCount = () => ids.size;

// ═══════════════════════════════════════════════════════════════════════
// ID PREM - helper command /idprem (kategori tools, khusus owner).
//
// Ambil ID emoji premium (custom emoji) dari:
//   (a) pesan yang di-reply & berisi emoji premium, ATAU
//   (b) 1 PACK emoji premium utuh (reply stiker emoji / link t.me/addemoji/... / nama pack).
//
// Hasilnya ditampilkan per HALAMAN (10 ID per halaman) dengan tombol Prev / Next,
// supaya chat tidak dibanjiri pesan. Format ID yang bisa disalin: {ID|😀}
// ═══════════════════════════════════════════════════════════════════════
import { withEmoji } from "./richEmoji.js";

export const PAGE_SIZE = 10;
const DEFAULT_FALLBACK = "⭐";

const PACK_LINK_RE = /(?:https?:\/\/)?(?:t|telegram)\.me\/(?:addemoji|addstickers)\/([A-Za-z0-9_]{1,64})/i;
const PACK_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Emoji cadangan gak boleh ngandung { } | (bakal ngerusak format marker)
// dan gak boleh kosong.
function cleanFallback(value) {
  const cleaned = String(value ?? '').replace(/[{}|<>&\s]/g, '');
  return cleaned || DEFAULT_FALLBACK;
}

// Semua emoji premium di 1 pesan (teks/caption/stiker emoji), urut kemunculan,
// tanpa duplikat. Balikin [{ id, fallback }].
export function extractCustomEmojis(msg) {
  if (!msg || typeof msg !== 'object') return [];
  const out = [];
  const seen = new Set();
  const push = (id, fallback) => {
    const key = String(id || '');
    if (!/^\d{5,}$/.test(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, fallback: cleanFallback(fallback) });
  };

  const sources = [
    [msg.text, msg.entities],
    [msg.caption, msg.caption_entities],
  ];
  for (const [text, entities] of sources) {
    if (typeof text !== 'string' || !Array.isArray(entities)) continue;
    for (const ent of entities) {
      if (!ent || ent.type !== 'custom_emoji' || !ent.custom_emoji_id) continue;
      // offset/length Telegram dihitung dalam UTF-16 code unit - sama persis
      // kayak indexing string JavaScript, jadi slice langsung aman.
      push(ent.custom_emoji_id, text.slice(ent.offset, ent.offset + ent.length));
    }
  }
  if (msg.sticker && msg.sticker.custom_emoji_id) {
    push(msg.sticker.custom_emoji_id, msg.sticker.emoji);
  }
  return out;
}

// Stiker hasil getStickerSet -> [{ id, fallback }] (yang punya custom_emoji_id aja).
export function emojisFromStickers(stickers) {
  const out = [];
  for (const s of Array.isArray(stickers) ? stickers : []) {
    if (!s || !s.custom_emoji_id) continue;
    out.push({ id: String(s.custom_emoji_id), fallback: cleanFallback(s.emoji) });
  }
  return out;
}

function packNameFromText(str) {
  const m = PACK_LINK_RE.exec(String(str || ''));
  return m ? m[1] : null;
}

// Argumen command: link pack ATAU nama pack polos. null kalau bukan keduanya.
export function parsePackArg(arg) {
  const a = String(arg || '').trim();
  if (!a) return null;
  return packNameFromText(a) || (PACK_NAME_RE.test(a) ? a : null);
}

// Nama pack dari pesan yang di-reply: stiker (set_name) atau link
// t.me/addemoji/... di teks/caption/text_link.
export function findPackNameInMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.sticker && msg.sticker.set_name) return String(msg.sticker.set_name);

  const texts = [msg.text, msg.caption];
  for (const ents of [msg.entities, msg.caption_entities]) {
    if (!Array.isArray(ents)) continue;
    for (const e of ents) if (e && e.type === 'text_link' && e.url) texts.push(e.url);
  }
  for (const t of texts) {
    const name = packNameFromText(t);
    if (name) return name;
  }
  return null;
}


// ── Halaman ──
export const pageCount = (list) => Math.max(1, Math.ceil((Array.isArray(list) ? list.length : 0) / PAGE_SIZE));
export const clampPage = (page, list) => Math.min(Math.max(0, Number(page) || 0), pageCount(list) - 1);

const marker = (e) => `{${e.id}|${cleanFallback(e.fallback)}}`;

// Versi teks biasa (HTML) satu halaman - dipakai kalau server menolak Rich Message.
// '{' ditulis &#123; supaya lapisan richEmoji tidak mengubah marker jadi emoji.
export function buildLegacyPage(list, title, page) {
  const p = clampPage(page, list);
  const start = p * PAGE_SIZE;
  const lines = list.slice(start, start + PAGE_SIZE).map((e, i) => {
    return `${start + i + 1}. <code>&#123;${e.id}|${escapeHtml(cleanFallback(e.fallback))}}</code>`;
  });
  return `<b>${escapeHtml(title)}</b>\nHalaman ${p + 1}/${pageCount(list)}\n\n${lines.join("\n")}`;
}

// Rich Message (blocks) satu halaman: tabel judul + per baris 1 tabel kecil + tombol Copy.
// Penomoran lanjut terus (1..N) antar halaman. Tombol Copy memakai copy_text (tanpa callback).
export function buildRichPage(list, title, page) {
  const p = clampPage(page, list);
  const total = pageCount(list);
  const start = p * PAGE_SIZE;
  const cell = (text, extra) => ({ align: "center", valign: "middle", text, ...(extra || {}) });
  const head = (text) => cell(text, { is_header: true });

  const titleText = `${title} (hal ${p + 1}/${total})`;
  const blocks = [{
    type: "table",
    is_bordered: true,
    cells: [
      [cell({ type: "bold", text: titleText }, { is_header: true, colspan: 4 })],
      [head("NO"), head("EMOJI"), head("ID EMOJI"), head("FALLBACK EMOJI")],
    ],
  }];

  list.slice(start, start + PAGE_SIZE).forEach((e, i) => {
    const n = start + i + 1;
    const fb = cleanFallback(e.fallback);
    const m = marker(e);
    blocks.push({
      type: "table",
      is_bordered: true,
      cells: [[
        cell(String(n)),
        cell(withEmoji(m)),                 // emoji premium sungguhan
        cell({ type: "code", text: m }),    // node code: marker tetap teks yang bisa disalin
        cell({ type: "code", text: fb }),   // emoji cadangan polos (node code tidak dijadikan premium)
      ]],
    });
    blocks.push({
      type: "buttons",
      buttons: [{ text: `Copy ${n}`, copy_text: { text: m.slice(0, 256) }, style: "danger" }],
    });
  });
  return { blocks };
}

// Nama bot -> aman dipakai di nama file (buang karakter terlarang).
function safeBotName(name) {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "Bot";
}

// File hasil lengkap (SEMUA halaman) untuk tombol unduh.
// Nama file wajib "EmojiPrem By {namabot}.js"; isi: header lalu 1 ID per baris.
export function buildExportFile(list, title, botName) {
  const name = safeBotName(botName);
  const seen = new Set();
  const ids = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    ids.push(e.id);
  }
  const text = `//ID Emoji Premium By ${name}\n${ids.join("\n")}\n`;
  return { text, filename: `EmojiPrem By ${name}.js`, total: ids.length };
}

// Tombol navigasi + unduh. token = id sesi.
export function buildKeyboard(token, list, page) {
  const p = clampPage(page, list);
  const total = pageCount(list);
  const nav = [];
  if (p > 0) nav.push({ text: "◀️ Prev", callback_data: `idprem:go:${token}:${p - 1}` });
  nav.push({ text: `${p + 1}/${total}`, callback_data: "idprem:noop" });
  if (p < total - 1) nav.push({ text: "Next ▶️", callback_data: `idprem:go:${token}:${p + 1}` });
  return {
    inline_keyboard: [
      nav,
      [{ text: "📥 Unduh Semua Hasil", callback_data: `idprem:dl:${token}` }],
    ],
  };
}

// ── Sesi (in-memory): hasil /idprem disimpan sebentar supaya Prev/Next tidak perlu ambil ulang ──
const SESSION_TTL = 30 * 60_000;
const SESSION_MAX = 200;
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.at > SESSION_TTL) sessions.delete(k);
  while (sessions.size > SESSION_MAX) sessions.delete(sessions.keys().next().value);
}

export function createSession(userId, list, title) {
  sweep();
  let token;
  do { token = Math.random().toString(36).slice(2, 8); } while (!token || sessions.has(token));
  sessions.set(token, { userId: String(userId), list, title, mode: "rich", at: Date.now() });
  return token;
}

export function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL) { sessions.delete(token); return null; }
  s.at = Date.now();
  return s;
}

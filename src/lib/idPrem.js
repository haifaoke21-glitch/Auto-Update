// ═══════════════════════════════════════════════════════════════════════
// ID PREM - helper command /idprem (kategori tools, khusus owner).
//
// Ambil ID emoji premium (custom emoji) dari:
//   (a) pesan yang di-reply & berisi emoji premium, ATAU
//   (b) 1 PACK emoji premium utuh (reply stiker emoji / link t.me/addemoji/... / nama pack).
//
// Hasilnya langsung dikirim SEMUA sekaligus sebagai file .js bernama
// "EmojiPrem By {namabot}.js" (format sama seperti data/EmojiPrem: emojiMap + emojiAll).
// ═══════════════════════════════════════════════════════════════════════
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


// ── File hasil (semua emoji sekaligus) ──
// Nama bot -> aman dipakai di nama file (buang karakter terlarang).
function safeBotName(name) {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "Bot";
}

// Nama file wajib: "EmojiPrem By {namabot}.js"
export const exportFilename = (botName) => `EmojiPrem By ${safeBotName(botName)}.js`;

// Isi file .js: SEMUA hasil cek (bukan per 10 baris), formatnya sama dengan data/EmojiPrem:
//   emojiMap : emoji -> ID utama (kemunculan pertama)
//   emojiAll : emoji -> semua ID miliknya
export function buildExportFile(list, title, botName) {
  const name = safeBotName(botName);
  const plainTitle = String(title || "idprem").replace(/^[^\p{L}\p{N}]+/u, "").replace(/[\r\n]+/g, " ");
  const groups = new Map(); // emoji cadangan -> [id, ...] (tanpa duplikat)
  for (const e of Array.isArray(list) ? list : []) {
    const key = cleanFallback(e.fallback);
    if (!groups.has(key)) groups.set(key, []);
    const ids = groups.get(key);
    if (!ids.includes(e.id)) ids.push(e.id);
  }

  const mapLines = [...groups].map(([emo, ids]) => `  ${JSON.stringify(emo)}: ${JSON.stringify(ids[0])},`);
  const allLines = [...groups].map(([emo, ids]) => `  ${JSON.stringify(emo)}: [${ids.map((id) => JSON.stringify(id)).join(", ")}],`);
  const total = [...groups.values()].reduce((n, ids) => n + ids.length, 0);

  const text =
    `// Emoji Premium by ${name}\n` +
    `// Hasil /idprem: ${plainTitle}\n` +
    `// Total: ${total} ID untuk ${groups.size} emoji\n` +
    `//\n` +
    `// emojiMap : emoji -> custom_emoji_id UTAMA (kemunculan pertama).\n` +
    `// emojiAll : emoji -> SEMUA custom_emoji_id miliknya.\n\n` +
    `export const emojiMap = {\n${mapLines.join("\n")}\n};\n\n` +
    `export const emojiAll = {\n${allLines.join("\n")}\n};\n`;
  return { text, filename: exportFilename(name), total, emojiCount: groups.size };
}

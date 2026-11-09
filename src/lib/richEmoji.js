// ═══════════════════════════════════════════════════════════════════════
// RICH EMOJI - emoji premium (custom emoji) buat Rich Message.
//
// SINTAKS (di string mana aja):   {ID|😀}
//   contoh: rich('{5877482652302315100|🗂️} CATEGORI')
//   ID    = custom_emoji_id (angka, min 5 digit)
//   😀    = emoji cadangan (tampil kalau emoji premium gak bisa ditampilin)
//
// CARA KERJA:
//   1) rich('teks')  -> balikin string biasa (kalau gak ada marker) atau
//      array RichText [ 'teks ', { type:'custom_emoji', ... }, ' lanjut' ].
//      Bisa dipake langsung di  text: rich('...')  di block mana aja.
//   2) transformApiPayload() dipasang SEKALI di lapisan Bot API
//      (telegrafCompat.js), jadi SEMUA Rich Message yang keluar (sendRichMessage,
//      editMessageText, sendRichMessageDraft, hasil inline/answerInlineQuery)
//      otomatis dikonversi - biarpun string-nya GAK dibungkus rich().
//      Yang parse_mode HTML biasa: marker -> <tg-emoji emoji-id="ID">😀</tg-emoji>.
//
// CATATAN: emoji premium dari bot cuma muncul kalau OWNER bot punya Telegram
// Premium. Kalau gak, yang tampil emoji cadangannya (gak error).
// ═══════════════════════════════════════════════════════════════════════

import { richParts, htmlEmoji, richMarkdownEmoji, stripHtmlEmoji, plainEmojiFor } from './premiumEmoji.js';

const MARKER_SRC = '\\{(\\d{5,})\\|([^{}|]+?)\\}';
const hasMarkerStr = (s) => typeof s === 'string' && new RegExp(MARKER_SRC).test(s);

// "teks {ID|😀} lanjut" -> array RichText, atau string asli kalau gak ada marker.
function withEmoji(str) {
  if (!hasMarkerStr(str)) return str;
  const re = new RegExp(MARKER_SRC, 'g');
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) parts.push(str.slice(last, m.index));
    parts.push({ type: 'custom_emoji', custom_emoji_id: m[1], alternative_text: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts;
}

const rich = withEmoji;

// Emoji premium ASLI di teks pesan userbot (entity custom_emoji dari gramjs:
// MessageEntityCustomEmoji { offset, length, documentId }) -> marker {ID|😀}.
// Dipake .buildrich biar emoji premium yang diketik langsung di pesan ikut
// jadi emoji premium di Rich Message (teks biasa dari message.message
// kehilangan info emojinya, tinggal emoji cadangannya doang).
// offset/length = UTF-16 code unit = indexing string JS, jadi slice langsung aman.
function entitiesToMarkers(text, entities) {
  if (typeof text !== 'string' || !Array.isArray(entities) || !entities.length) return text;
  const list = [];
  for (const ent of entities) {
    if (!ent) continue;
    const isCustom = ent.className === 'MessageEntityCustomEmoji' || ent.type === 'custom_emoji';
    const id = String(ent.documentId != null ? ent.documentId : (ent.custom_emoji_id || ''));
    if (!isCustom || !/^\d{5,}$/.test(id)) continue;
    if (!Number.isInteger(ent.offset) || !Number.isInteger(ent.length) || ent.length <= 0) continue;
    list.push({ id, offset: ent.offset, end: ent.offset + ent.length });
  }
  list.sort((a, b) => b.offset - a.offset); // ganti dari belakang biar offset depan gak geser
  let out = text;
  let limit = Infinity;
  for (const e of list) {
    if (e.end > limit || e.end > out.length) continue;
    // emoji cadangan gak boleh ngandung { } | < > & / spasi (ngerusak format marker)
    const fallback = out.slice(e.offset, e.end).replace(/[{}|<>&\s]/g, '') || '⭐';
    out = out.slice(0, e.offset) + `{${e.id}|${fallback}}` + out.slice(e.end);
    limit = e.offset;
  }
  return out;
}

// Marker -> tag HTML (buat parse_mode HTML / field `html` Rich Message).
function toHtmlEmoji(str) {
  if (!hasMarkerStr(str)) return str;
  return str.replace(new RegExp(MARKER_SRC, 'g'), (_, id, alt) => `<tg-emoji emoji-id="${id}">${alt.trim()}</tg-emoji>`);
}

// Marker -> sintaks markdown Rich Message.
function toMarkdownEmoji(str) {
  if (!hasMarkerStr(str)) return str;
  return str.replace(new RegExp(MARKER_SRC, 'g'), (_, id, alt) => `![${alt.trim()}](tg://emoji?id=${id})`);
}

// Marker -> emoji cadangan doang (buat teks polos, mis. alert popup).
function stripEmojiMarkers(str) {
  if (!hasMarkerStr(str)) return str;
  return str.replace(new RegExp(MARKER_SRC, 'g'), (_, _id, alt) => alt.trim());
}

const isPlain = (v) => v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);

// Cek cepat: ada marker di struktur plain (skip InputFile/Buffer/stream).
function hasMarker(v) {
  if (typeof v === 'string') return hasMarkerStr(v);
  if (!isPlain(v)) return false;
  if (Array.isArray(v)) return v.some(hasMarker);
  return Object.values(v).some(hasMarker);
}

// Emoji biasa di teks -> custom emoji premium (daftar data/EmojiPrem By @AboutAzmi.js).
// Terima string / array hasil withEmoji(); bagian string yang belum jadi custom_emoji dipotong ulang.
function premiumize(v) {
  if (typeof v === 'string') return richParts(v);
  if (Array.isArray(v)) {
    const out = [];
    for (const n of v) {
      const c = typeof n === 'string' ? richParts(n) : n;
      if (Array.isArray(c)) out.push(...c); else out.push(c);
    }
    return out;
  }
  return v;
}

// ── RichText ──
function convText(node) {
  if (typeof node === 'string') return premiumize(withEmoji(node));
  if (Array.isArray(node)) {
    const out = [];
    for (const n of node) {
      const c = convText(n);
      if (Array.isArray(c)) out.push(...c); else out.push(c);
    }
    return out;
  }
  if (!isPlain(node)) return node;
  if (node.type === 'custom_emoji' || node.type === 'code') return node; // code: gak bisa nampung emoji
  const copy = { ...node };
  if ('text' in copy) copy.text = convText(copy.text);
  if ('credit' in copy) copy.credit = convText(copy.credit);
  return copy;
}

// ── RichBlock ──
function convBlock(block) {
  if (!isPlain(block)) return block;
  const b = { ...block };
  if (b.type !== 'pre') {
    if ('text' in b) b.text = convText(b.text);
  }
  if ('summary' in b) b.summary = convText(b.summary);
  if ('credit' in b) b.credit = convText(b.credit);
  if ('caption' in b) b.caption = convText(b.caption);
  if (Array.isArray(b.blocks)) b.blocks = b.blocks.map(convBlock);
  if (Array.isArray(b.items)) {
    b.items = b.items.map((it) => (isPlain(it) && Array.isArray(it.blocks) ? { ...it, blocks: it.blocks.map(convBlock) } : it));
  }
  if (Array.isArray(b.cells)) {
    b.cells = b.cells.map((row) => (Array.isArray(row)
      ? row.map((cell) => (isPlain(cell) && 'text' in cell ? { ...cell, text: convText(cell.text) } : cell))
      : row));
  }
  if (Array.isArray(b.buttons)) {
    b.buttons = b.buttons.map((btn) => (isPlain(btn) && 'text' in btn ? { ...btn, text: convText(btn.text) } : btn));
  }
  return b;
}

// InputRichMessage ({ blocks } / { html } / { markdown }).
function transformRichMessage(rm) {
  if (!isPlain(rm)) return rm;
  const out = { ...rm };
  if (Array.isArray(out.blocks)) out.blocks = out.blocks.map(convBlock);
  if (typeof out.html === 'string') out.html = htmlEmoji(toHtmlEmoji(out.html));
  if (typeof out.markdown === 'string') out.markdown = richMarkdownEmoji(toMarkdownEmoji(out.markdown));
  return out;
}

// Payload satu panggilan Bot API. Balikin objek BARU kalau ada yang berubah
// (objek asli - konstanta teks yang dipake ulang - gak pernah dimutasi).
function transformApiPayload(p) {
  if (!isPlain(p) || Array.isArray(p) || !hasMarker(p)) return p;
  const out = { ...p };
  if ('rich_message' in out) out.rich_message = transformRichMessage(out.rich_message);
  const isHtml = /html/i.test(String(out.parse_mode || ''));
  if (isHtml) {
    if (typeof out.text === 'string') out.text = toHtmlEmoji(out.text);
    if (typeof out.caption === 'string') out.caption = toHtmlEmoji(out.caption);
  }
  if (Array.isArray(out.results)) {
    out.results = out.results.map((r) => {
      const c = isPlain(r) && r.input_message_content;
      if (!c || !hasMarker(c)) return r;
      const content = { ...c };
      if ('rich_message' in content) content.rich_message = transformRichMessage(content.rich_message);
      if (typeof content.message_text === 'string' && /html/i.test(String(content.parse_mode || ''))) {
        content.message_text = toHtmlEmoji(content.message_text);
      }
      return { ...r, input_message_content: content };
    });
  }
  return out;
}

// Bungkus objek `Api` (node-telegram-bot-api) - SEMUA method-nya otomatis
// nge-transform payload sebelum dikirim.
function wrapApi(api) {
  return new Proxy(api, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return function wrapped(...args) {
        try {
          if (args[0] && typeof args[0] === 'object') args[0] = transformApiPayload(args[0]);
        } catch (err) {
          console.error('[richEmoji] gagal transform payload, dikirim apa adanya:', err.message);
        }
        return value.apply(target, args);
      };
    },
  });
}

// ── Mode emoji BIASA (pemilik bot tidak premium) ──
// Kebalikan transformRichMessage: custom_emoji, marker {ID|😀}, <tg-emoji> dan ![😀](tg://emoji?id=ID)
// semuanya dikembalikan jadi emoji biasa. Objek asli tidak dimutasi.
function stripNode(v) {
  if (typeof v === 'string') return stripEmojiMarkers(v);
  if (Array.isArray(v)) return v.map(stripNode);
  if (!isPlain(v)) return v;
  if (v.type === 'custom_emoji') return String(v.alternative_text || '').trim() || plainEmojiFor(v.custom_emoji_id);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = stripNode(val);
  return out;
}

function stripRichMessage(rm) {
  if (!isPlain(rm)) return rm;
  const out = { ...rm };
  if (Array.isArray(out.blocks)) out.blocks = out.blocks.map(stripNode);
  if (typeof out.html === 'string') out.html = stripHtmlEmoji(stripEmojiMarkers(out.html));
  if (typeof out.markdown === 'string') {
    out.markdown = stripEmojiMarkers(out.markdown).replace(/!\[([^\]]*)\]\(tg:\/\/emoji\?id=\d+\)/g, '$1');
  }
  return out;
}

export {
  rich, withEmoji, entitiesToMarkers, toHtmlEmoji, toMarkdownEmoji, stripEmojiMarkers,
  transformRichMessage, stripRichMessage, transformApiPayload, wrapApi, hasMarker,
};

// ═══════════════════════════════════════════════════════════════════════
// USERBOT BUILDRICH - parser buat ".buildrich": ngubah teks markup
// singkat jadi array block Rich Message (heading/divider/table/details/
// list/footer/paragraph/buttons) + versi fallback HTML biasa (kalau Rich
// Message via bot gak bisa dipake).
//
// FORMAT (tiap elemen 1 baris, keyword HURUF BESAR):
//   H(teks)              -> heading
//   D                    -> divider (garis pemisah)
//   T(teks)              -> tabel; baris ini = baris HEADER tabelnya
//   (sel) (sel)          -> baris data tabel (baris-baris yang diawali "("
//   (sel)(sel)              tepat di bawah T; spasi antar sel opsional)
//   EX(judul)            -> expandable/lipat; isinya = baris-baris di bawahnya
//   isi ...                 sampai ketemu BARIS KOSONG. Isi boleh campur tipe:
//                           teks biasa (paragraf), H(..), D, T(..)+baris sel,
//                           L(..), C(..)/CC(..). Gak boleh di dalam EX: EX
//                           lain (nested), F(..), dan tombol B/BP/BS/BD.
//   L(teks)              -> list (bullet); item pertama = isi L(..), item
//   (teks) (teks)           berikutnya = baris-baris "(teks)" tepat di
//   (teks)(teks)            bawahnya (boleh beberapa item per baris, sama
//                           kayak baris sel tabel), sampai baris kosong/keyword
//   C(teks)              -> list dengan CHECKBOX kosong (has_checkbox). Sama kayak
//   CC(teks)                L: item berikutnya = baris "(teks)" di bawahnya, ikut
//                           status baris C/CC di atasnya. CC = checkbox TERCENTANG
//                           (has_checkbox + is_checked). Baris C(..) & CC(..) yang
//                           nyambung jadi 1 list (boleh campur centang & kosong).
//   F(teks)              -> footer (catatan kecil di paling bawah pesan)
//   B(teks,link)         -> tombol link Rich Message (warna default).
//   BP(teks,link)           Varian warna: BP = primary (biru), BS = success
//   BS(teks,link)           (hijau), BD = danger (merah).
//   BD(teks,link)           1 BARIS = 1 baris tombol; beberapa tombol di baris
//                           yang sama (BS(..)BD(..)) jadi sejajar, baris baru
//                           = baris tombol baru (mis. layout 2-1).
//   teks biasa           -> paragraf
//
// FORMAT TEKS: prefix modifier di depan keyword (1 modifier per baris):
//   BQ = blockquote  B = bold  P = pre  CD = code
//   BQH(teks) heading blockquote | CDL(a) list code | BF(teks) footer bold
//   BQ(teks) / CD(teks) / P(teks) = paragraf ber-format
//   (B( BP( BS( BD( tetep tombol; tabel T(..) & EX(..) belum bisa pake modifier)
//
// EMOJI PREMIUM: ketik emoji premium langsung di teks mana aja (heading,
// paragraf, sel tabel, list, judul/isi EX, teks tombol, footer) - otomatis
// jadi emoji premium di Rich Message. Bisa juga nulis marker manual {ID|😀}.
//
// Baris kosong = pemisah (nutup tabel/expandable/list yang lagi kebuka).
// Kalau baris di T punya sel lebih sedikit dari baris terlebar, sel
// terakhirnya otomatis di-colspan biar tabelnya tetep rapi (makanya
// "T(judul)" 1 sel jadi header selebar tabel).
// ═══════════════════════════════════════════════════════════════════════

import config from '../../config.js';
import { toHtmlEmoji, stripEmojiMarkers } from './richEmoji.js';

const MAX_BLOCKS = 60;

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Tombol: B(teks,link) / BP / BS / BD ──
const BTN_STYLES = { D: 'danger', P: 'primary', S: 'success' };

function isButtonLine(line) {
  return /^B[DPS]?\(/.test(line);
}

// ── MODIFIER FORMAT TEKS ──
// Prefix di depan keyword block buat ngeformat teksnya (1 modifier per baris):
//   BQ = blockquote   B = bold   P = pre   CD = code
//   BQH(teks)  -> heading dijadiin blockquote     BL(a) -> list bold
//   CD(teks)   -> paragraf code                   PH(teks) -> heading pre
// Keyword yang bisa dikombinasi: H, L, C, CC, F (atau tanpa keyword = paragraf).
// B( / BP( / BS( / BD( tetep TOMBOL (bukan modifier), jadi paragraf bold pake
// H/L/C/F versi B, mis. BH(..).
//
// B  & CD = segmen RichText  { type:'bold'|'code', text }  (terbukti dipake di bot ini)
// BQ & P  = BLOCK sendiri    { type:'blockquote', blocks:[paragraph] } / { type:'pre', text:'polos' }
//   (sesuai Bot API 10.1: RichBlockBlockQuotation isinya `blocks`, bukan `text`).
//   Kalau Telegram tetap nolak, userbotMenu.js otomatis kirim ulang pake
//   downgradeBlocks() (blockquote -> paragraf bertanda ▎, pre -> code).
const TEXT_MOD_TYPES = { B: 'bold', CD: 'code' };
const MOD_RE = /^(BQ|CD|B|P)(H|L|CC|C|F|T)?\(/;

// "BQH(teks)" -> { mod: 'BQ', rest: 'H(teks)' }. Paragraf ber-modifier
// ("BQ(teks)") -> rest = baris utuh, ditandai plain: true.
function splitMod(line) {
  if (isButtonLine(line)) return { mod: null, rest: line };
  const m = MOD_RE.exec(line);
  if (!m) return { mod: null, rest: line };
  if (m[2]) return { mod: m[1], rest: line.slice(m[1].length) };
  return { mod: m[1], rest: line, plain: true };
}

// Bungkus teks jadi segmen RichText ber-format (khusus B / CD). Marker emoji premium
// {ID|😀} di dalam `bold` tetep diproses lapisan richEmoji; `code` cuma nampung teks
// polos, jadi emojinya di-stripEmojiMarkers biar gak jadi teks mentah.
function styleText(text, mod) {
  const type = TEXT_MOD_TYPES[mod];
  if (!type) return text;
  if (type === 'code') return [{ type, text: stripEmojiMarkers(text) }];
  return [{ type, text }];
}

// Bikin block teks (paragraph / heading / footer) sesuai modifier.
// BQ -> block blockquote, P -> block pre, B/CD -> block asli + segmen ber-format.
function makeTextBlock(kind, text, mod) {
  // Bot API 10.3: expandable_blockquote = { type, text:RichText, credit? } -> kutipan Telegram biasa.
  // Bot API 10.1: blockquote = { type, blocks:[RichBlock], credit? } -> kutipan gaya artikel (gede).
  // Pilihan lewat global.richQuoteType di settings.js (default: expandable_blockquote).
  if (mod === 'BQ') {
    const qt = kind === 'heading' ? [{ type: 'bold', text }] : text;
    if (config.rich?.quoteType === 'blockquote') return { type: 'blockquote', blocks: [{ type: 'paragraph', text: qt }] };
    return { type: 'expandable_blockquote', text: qt };
  }
  if (mod === 'P') return { type: 'pre', text: stripEmojiMarkers(text) };
  const t = styleText(text, mod);
  if (kind === 'heading') return { type: 'heading', text: t, size: 2 };
  if (kind === 'footer') return { type: 'footer', text: t };
  return { type: 'paragraph', text: t };
}

function hasExpandableQuote(blocks) {
  return (blocks || []).some((b) => {
    if (!b || typeof b !== 'object') return false;
    if (b.type === 'expandable_blockquote') return true;
    if (Array.isArray(b.blocks) && hasExpandableQuote(b.blocks)) return true;
    if (Array.isArray(b.items)) return b.items.some((it) => it && hasExpandableQuote(it.blocks));
    return false;
  });
}

// expandable_blockquote -> blockquote klasik ({ blocks:[paragraph] }). Percobaan kedua kalau
// server belum kenal tipe 10.3.
function classicQuotes(blocks) {
  return (blocks || []).map((b) => {
    if (!b || typeof b !== 'object') return b;
    if (b.type === 'expandable_blockquote') return { type: 'blockquote', blocks: [{ type: 'paragraph', text: b.text }] };
    const copy = { ...b };
    if (Array.isArray(copy.blocks)) copy.blocks = classicQuotes(copy.blocks);
    if (Array.isArray(copy.items)) copy.items = copy.items.map((it) => (it && Array.isArray(it.blocks) ? { ...it, blocks: classicQuotes(it.blocks) } : it));
    return copy;
  });
}

// Teks (RichText) dari block blockquote: gabung teks tiap block di dalamnya
// (paragraph/heading/pre), dipisah baris baru. Bentuk lama { text } tetap didukung.
function quoteText(b) {
  if (!Array.isArray(b.blocks)) return b.text == null ? '' : b.text;
  const parts = [];
  b.blocks.forEach((x, i) => {
    if (i > 0) parts.push('\n');
    const t = x && x.text != null ? x.text : '';
    if (Array.isArray(t)) parts.push(...t); else parts.push(t);
  });
  return parts;
}

// ── DOWNGRADE (jaring pengaman) ──
// Type yang namanya belum terbukti di server: blockquote & pre.
const GUESSED_TYPES = new Set(['blockquote', 'expandable_blockquote', 'pre']);
const QUOTE_TYPES = new Set(['blockquote', 'expandable_blockquote']);

function needsDowngrade(blocks) {
  return (blocks || []).some((b) => {
    if (!b || typeof b !== 'object') return false;
    if (GUESSED_TYPES.has(b.type)) return true;
    if (Array.isArray(b.blocks) && needsDowngrade(b.blocks)) return true;
    if (Array.isArray(b.items)) return b.items.some((it) => it && needsDowngrade(it.blocks));
    return false;
  });
}

// blockquote -> paragraf dengan penanda "▎" + teks tebal; pre -> paragraf code.
// Dipake kalau Telegram nolak block blockquote/pre. Cuma pake type yang terbukti jalan.
function downgradeBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (!b || typeof b !== 'object') return b;
    if (QUOTE_TYPES.has(b.type)) {
      const qt = quoteText(b);
      const inner = Array.isArray(qt) ? qt : [{ type: 'bold', text: String(qt) }];
      return { type: 'paragraph', text: ['▎ ', ...inner] };
    }
    if (b.type === 'pre') return { type: 'paragraph', text: [{ type: 'code', text: String(b.text) }] };
    const copy = { ...b };
    if (Array.isArray(copy.blocks)) copy.blocks = downgradeBlocks(copy.blocks);
    if (Array.isArray(copy.items)) copy.items = copy.items.map((it) => (it && Array.isArray(it.blocks) ? { ...it, blocks: downgradeBlocks(it.blocks) } : it));
    return copy;
  });
}

// Pisahin "teks,link" jadi [teks, link]. Koma yang dipake = koma pertama yang
// DIIKUTIN link (http(s)://, tg://, t.me/, www., @user) - biar teks tombol yang
// ada komanya atau URL yang ada komanya tetep aman; kalau gak ada, koma terakhir.
function splitTextLink(inner) {
  const m = inner.match(/,\s*(?=(?:https?:\/\/|tg:\/\/|t\.me\/|telegram\.me\/|www\.|@))/i);
  const idx = m ? m.index : inner.lastIndexOf(',');
  if (idx < 0) return null;
  return [inner.slice(0, idx).trim(), inner.slice(idx + 1).trim()];
}

// Rapihin link: @user -> https://t.me/user, t.me/x / www.x / domain.com -> tambah https://.
// Balikin null kalau bentuknya bukan link valid (yang boleh: http, https, tg).
function normalizeLink(raw) {
  let l = String(raw || '').trim();
  if (!l) return null;
  if (/^@[A-Za-z0-9_]{4,}$/.test(l)) return `https://t.me/${l.slice(1)}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(l) && /^[^\s/?#]+\.[a-z]{2,}([/?#]|$)/i.test(l)) l = `https://${l}`;
  return /^(https?|tg):\/\/\S+$/i.test(l) ? l : null;
}

// "BS(a,link)BD(b,link)" -> { buttons: [{text,url,style}, ...] } atau { error }.
function parseButtonLine(line, lineNo) {
  const buttons = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (/\s/.test(line[i])) { i++; continue; }
    const m = /^B([DPS]?)\(/.exec(line.slice(i));
    if (!m) {
      return { error: `Baris ${lineNo}: di baris tombol cuma boleh B(..) / BP(..) / BS(..) / BD(..), ada teks nyasar: \"${line.slice(i, i + 15)}\"` };
    }
    const open = i + m[0].length - 1;
    let depth = 0;
    let j = open;
    for (; j < n; j++) {
      if (line[j] === '(') depth++;
      else if (line[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return { error: `Baris ${lineNo}: tanda kurung tombol gak ketutup.` };
    const parts = splitTextLink(line.slice(open + 1, j));
    if (!parts || !parts[0] || !parts[1]) {
      return { error: `Baris ${lineNo}: format tombol harus ${m[0]}teks,link) - teks & link-nya gak boleh kosong, dipisah koma.` };
    }
    const url = normalizeLink(parts[1]);
    if (!url) return { error: `Baris ${lineNo}: link tombol \"${parts[1].slice(0, 40)}\" gak valid (harus http://, https://, tg://, t.me/..., atau @username).` };
    const btn = { text: parts[0], url };
    if (BTN_STYLES[m[1]]) btn.style = BTN_STYLES[m[1]];
    buttons.push(btn);
    i = j + 1;
  }
  return { buttons };
}

// "(a) (b)(c)" -> ['a','b','c']. Kurung bersarang yang seimbang boleh
// (mis. "(Harga (Rp))" -> 'Harga (Rp)'). Balikin { cells } atau { error }.
function parseCells(str) {
  const cells = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    if (/\s/.test(str[i])) { i++; continue; }
    if (str[i] !== '(') {
      return { error: `ada teks di luar tanda kurung: "${str.slice(i, i + 15)}"` };
    }
    let depth = 0;
    let j = i;
    for (; j < n; j++) {
      if (str[j] === '(') depth++;
      else if (str[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return { error: 'tanda kurung gak ketutup' };
    cells.push(str.slice(i + 1, j).trim());
    i = j + 1;
  }
  return { cells };
}

// "H(teks (bebas))" -> 'teks (bebas)'  (ambil dari kurung pertama sampai kurung tutup TERAKHIR)
function parseWrapped(line, keywordLen) {
  const rest = line.slice(keywordLen);
  if (rest[0] !== '(' || rest[rest.length - 1] !== ')') return null;
  return rest.slice(1, -1).trim();
}

function buildTable(rows) {
  const maxCols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((row, ri) => row.map((text, ci) => {
    const cell = {
      align: ri === 0 ? 'center' : 'left',
      valign: 'middle',
      text,
    };
    if (ri === 0) cell.is_header = true;
    // sel terakhir baris yang kependekan di-colspan biar tabel tetep rapi
    if (ci === row.length - 1 && row.length < maxCols) cell.colspan = maxCols - row.length + 1;
    return cell;
  }));
  return { type: 'table', is_bordered: true, is_striped: true, cells };
}

// Parse 1 elemen mulai dari baris ke-i. `inEx` = true kalau lagi di dalam
// EX(..) (EX lain, footer & tombol gak boleh di dalam expandable).
// Balikin { block, next } atau { error }.
function parseBlock(lines, i, inEx) {
  const lineNo = i + 1;
  const { mod, rest, plain } = splitMod(lines[i]);
  const line = rest;

  if (line === 'D') return { block: { type: 'divider' }, next: i + 1 };

  // paragraf ber-modifier: BQ(teks) / CD(teks) / P(teks)
  if (plain) {
    const text = parseWrapped(line, mod.length);
    // gak ditutup ")" di ujung baris = kemungkinan besar paragraf biasa yang
    // kebetulan diawali "P(" / "BQ(" / "CD(" -> jangan dianggap error, jadiin paragraf biasa
    if (text === null) return { block: { type: 'paragraph', text: line }, next: i + 1 };
    if (!text) return { error: `Baris ${lineNo}: format harus ${mod}(teks) dan teksnya gak boleh kosong.` };
    // P( berurutan = 1 block pre multi-baris (biar kayak blok kode utuh)
    if (mod === 'P') {
      const rowsP = [text];
      let j = i + 1;
      while (j < lines.length) {
        const nx = splitMod(lines[j]);
        if (nx.mod !== 'P' || !nx.plain) break;
        const t2 = parseWrapped(nx.rest, 1);
        if (!t2) break;
        rowsP.push(t2);
        j++;
      }
      return { block: { type: 'pre', text: stripEmojiMarkers(rowsP.join('\n')) }, next: j };
    }
    return { block: makeTextBlock('paragraph', text, mod), next: i + 1 };
  }

  if (/^H\(/.test(line)) {
    const text = parseWrapped(line, 1);
    if (text === null || !text) return { error: `Baris ${lineNo}: format heading harus H(teks) dan teksnya gak boleh kosong.` };
    return { block: makeTextBlock('heading', text, mod), next: i + 1 };
  }

  if (/^T\(/.test(line)) {
    if (mod) return { error: `Baris ${lineNo}: tabel belum bisa pake modifier (${mod}T). Pake T(..) biasa.` };
    const first = parseCells(line.slice(1));
    if (first.error) return { error: `Baris ${lineNo}: ${first.error}.` };
    const rows = [first.cells];
    i++;
    while (i < lines.length && lines[i].startsWith('(')) {
      const r = parseCells(lines[i]);
      if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
      rows.push(r.cells);
      i++;
    }
    return { block: buildTable(rows), next: i };
  }

  if (isButtonLine(line)) {
    if (inEx) return { error: `Baris ${lineNo}: tombol B/BP/BS/BD gak bisa ditaruh di dalam EX(..). Taruh setelah baris kosong (di luar expandable).` };
    const r = parseButtonLine(line, lineNo);
    if (r.error) return { error: r.error };
    return { block: { type: 'buttons', buttons: r.buttons }, next: i + 1 };
  }

  if (/^EX\(/.test(line)) {
    if (inEx) return { error: `Baris ${lineNo}: EX(..) gak bisa ditaruh di dalam EX(..) lain (nested gak didukung). Pisahin pake baris kosong.` };
    const title = parseWrapped(line, 2);
    if (title === null || !title) return { error: `Baris ${lineNo}: format expandable harus EX(judul) dan judulnya gak boleh kosong.` };
    i++;
    const inner = [];
    while (i < lines.length && lines[i]) {
      const r = parseBlock(lines, i, true);
      if (r.error) return r;
      inner.push(r.block);
      i = r.next;
    }
    if (!inner.length) return { error: `Baris ${lineNo}: EX(${title}) butuh minimal 1 baris isi tepat di bawahnya.` };
    return { block: { type: 'details', summary: [{ type: 'bold', text: title }], blocks: inner }, next: i };
  }

  if (/^L\(/.test(line)) {
    const first = parseWrapped(line, 1);
    if (first === null || !first) return { error: `Baris ${lineNo}: format list harus L(teks) dan teksnya gak boleh kosong.` };
    const items = [first];
    i++;
    while (i < lines.length && lines[i].startsWith('(')) {
      const r = parseCells(lines[i]);
      if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
      for (const cell of r.cells) {
        if (!cell) return { error: `Baris ${i + 1}: item list gak boleh kosong.` };
        items.push(cell);
      }
      i++;
    }
    return {
      block: { type: 'list', items: items.map((text) => ({ blocks: [makeTextBlock('paragraph', text, mod)] })) },
      next: i,
    };
  }

  if (/^CC?\(/.test(line)) {
    const items = [];
    while (i < lines.length) {
      const cur = splitMod(lines[i]);
      if (cur.mod !== mod || !/^CC?\(/.test(cur.rest)) break;
      const checked = cur.rest.startsWith('CC(');
      const first = parseWrapped(cur.rest, checked ? 2 : 1);
      if (first === null || !first) return { error: `Baris ${i + 1}: format checkbox harus C(teks) atau CC(teks) dan teksnya gak boleh kosong.` };
      items.push({ text: first, checked });
      i++;
      while (i < lines.length && lines[i].startsWith('(')) {
        const r = parseCells(lines[i]);
        if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
        for (const cell of r.cells) {
          if (!cell) return { error: `Baris ${i + 1}: item checkbox gak boleh kosong.` };
          items.push({ text: cell, checked });
        }
        i++;
      }
    }
    return {
      block: {
        type: 'list',
        items: items.map((it) => {
          const item = { blocks: [makeTextBlock('paragraph', it.text, mod)], has_checkbox: true };
          if (it.checked) item.is_checked = true;
          return item;
        }),
      },
      next: i,
    };
  }

  if (/^F\(/.test(line)) {
    if (inEx) return { error: `Baris ${lineNo}: footer F(..) gak bisa ditaruh di dalam EX(..). Taruh setelah baris kosong (di luar expandable).` };
    const text = parseWrapped(line, 1);
    if (text === null || !text) return { error: `Baris ${lineNo}: format footer harus F(teks) dan teksnya gak boleh kosong.` };
    return { block: makeTextBlock('footer', text, mod), next: i + 1 };
  }

  return { block: { type: 'paragraph', text: line }, next: i + 1 };
}

/**
 * @param {string} raw teks markup (tanpa ".buildrich")
 * @returns {{ blocks: Array } | { error: string }}
 */
function parseRichMarkup(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i]) { i++; continue; }
    const r = parseBlock(lines, i, false);
    if (r.error) return { error: r.error };
    blocks.push(r.block);
    i = r.next;
  }

  if (!blocks.length) return { error: 'Belum ada isi yang bisa dibikin.' };
  if (blocks.length > MAX_BLOCKS) return { error: `Kebanyakan elemen (${blocks.length}), maksimal ${MAX_BLOCKS}.` };
  return { blocks };
}

// Teks block (string atau array segmen dari styleText) -> HTML Bot API.
// flat = true: dipake di dalam <blockquote expandable> (blockquote/pre gak boleh
// nested di situ) -> wrapper blockquote/pre dibuang, bold/code tetep.
function textToHtml(text, flat) {
  if (!Array.isArray(text)) return esc(text);
  return text.map((seg) => {
    if (typeof seg === 'string') return esc(seg);
    const inner = esc(seg.text);
    if (seg.type === 'bold') return `<b>${inner}</b>`;
    if (seg.type === 'code') return `<code>${inner}</code>`;
    if (flat) return inner;
    if (seg.type === 'blockquote') return `<blockquote>${inner}</blockquote>`;
    if (seg.type === 'pre') return `<pre>${inner}</pre>`;
    return inner;
  }).join('');
}

// Teks polos dari block (buat deskripsi / pengecekan).
function textToPlain(text) {
  if (!Array.isArray(text)) return String(text == null ? '' : text);
  return text.map((seg) => (typeof seg === 'string' ? seg : String(seg.text == null ? '' : seg.text))).join('');
}

// Isi EX(..) di fallback HTML: <blockquote expandable> gak boleh nested tag
// <pre>, jadi tabel/list/dll di dalamnya dirender jadi teks biasa per baris.
function innerBlockToText(b) {
  if (b.type === 'heading') return Array.isArray(b.text) ? textToHtml(b.text, true) : `<b>${esc(b.text)}</b>`;
  if (b.type === 'paragraph') return textToHtml(b.text, true);
  if (QUOTE_TYPES.has(b.type)) return textToHtml(quoteText(b), true);
  if (b.type === 'pre') return esc(b.text);
  if (b.type === 'divider') return '──────────────';
  if (b.type === 'table') return b.cells.map((row) => esc(row.map((c) => c.text).join(' │ '))).join('\n');
  if (b.type === 'list') {
    return (b.items || []).map((item) => {
      const itemText = (item.blocks || []).map((p) => textToHtml(p.text, true)).join(' ');
      const mark = item.has_checkbox ? (item.is_checked ? '☑' : '☐') : '•';
      return `${mark} ${itemText}`;
    }).join('\n');
  }
  return '';
}

// Versi HTML biasa (parseMode html) - dipake kalau Rich Message via bot gak bisa.
function blocksToHtml(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading') out.push(Array.isArray(b.text) ? textToHtml(b.text) : `<b>${esc(b.text)}</b>`);
    else if (b.type === 'paragraph') out.push(textToHtml(b.text));
    else if (b.type === 'blockquote') out.push(`<blockquote>${textToHtml(quoteText(b), true)}</blockquote>`);
    else if (b.type === 'expandable_blockquote') out.push(`<blockquote expandable>${textToHtml(quoteText(b), true)}</blockquote>`);
    else if (b.type === 'pre') out.push(`<pre>${esc(b.text)}</pre>`);
    else if (b.type === 'divider') out.push('──────────────');
    else if (b.type === 'table') {
      const lines = b.cells.map((row) => row.map((c) => c.text).join(' │ '));
      out.push(`<pre>${esc(stripEmojiMarkers(lines.join('\n')))}</pre>`);
    } else if (b.type === 'buttons') {
      out.push(b.buttons.map((btn) => `<a href="${esc(btn.url).replace(/\"/g, '&quot;')}">${esc(stripEmojiMarkers(btn.text))}</a>`).join(' │ '));
    } else if (b.type === 'details') {
      const title = (b.summary || []).map((s) => s.text).join('');
      const body = (b.blocks || []).map(innerBlockToText).filter(Boolean).join('\n');
      out.push(`<blockquote expandable><b>${esc(title)}</b>\n${body}</blockquote>`);
    } else if (b.type === 'list') {
      const lines = (b.items || []).map((item) => {
        const itemText = (item.blocks || []).map((p) => textToHtml(p.text)).join(' ');
        const mark = item.has_checkbox ? (item.is_checked ? '☑' : '☐') : '•';
        return `${mark} ${itemText}`;
      });
      out.push(lines.join('\n'));
    } else if (b.type === 'footer') {
      out.push(Array.isArray(b.text) ? textToHtml(b.text) : `<i>${esc(b.text)}</i>`);
    }
  }
  // marker {ID|😀} -> <tg-emoji> (emoji premium juga jalan di jalur fallback ini)
  return toHtmlEmoji(out.join('\n'));
}

// Deskripsi singkat buat hasil inline (cuma kelihatan di daftar inline, bukan di pesan).
function describeBlocks(blocks) {
  const first = blocks.find((b) => b.type === 'heading' || b.type === 'paragraph' || QUOTE_TYPES.has(b.type));
  const t = first ? stripEmojiMarkers(textToPlain(QUOTE_TYPES.has(first.type) ? quoteText(first) : first.text)) : `${blocks.length} elemen`;
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}

export { parseRichMarkup, blocksToHtml, describeBlocks, needsDowngrade, downgradeBlocks, classicQuotes, hasExpandableQuote };

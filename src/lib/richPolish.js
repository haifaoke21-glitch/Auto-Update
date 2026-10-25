// ═══════════════════════════════════════════════════════════════════════
// PERAPI OTOMATIS buat hasil .autorich (tata baca + tata letak).
// Dua tahap, dua-duanya deterministik (gak manggil AI lagi):
//
//   1. tidyMarkup(markup)  - SEBELUM parse. Rapihin tata letak markup:
//        * sisa markdown (** __ ` #) dibuang
//        * baris kosong dirapihin (maks 1), dikasih sebelum EX / F / tombol / D
//          (biar EX gak nyedot elemen sesudahnya)
//        * divider (D) di awal / akhir / dobel / tepat sebelum footer dibuang
//   2. polishBlocks(blocks) - SESUDAH parse. Rapihin tata baca teks tiap block:
//        * spasi ganda, spasi sebelum tanda baca, spasi setelah koma/titik
//        * !!! -> !   ??? -> ?   .. -> ...
//        * huruf pertama kapital, awal kalimat sesudah titik kapital
//        * heading / judul EX / sel tabel / item list: titik di ujung dibuang
//        * paragraf / kutipan / footer: dikasih titik kalau belum ada tanda akhir
//      Yang DIJAGA (gak disentuh): marker emoji premium {ID|😀}, URL, email,
//      @username, #hashtag, jam (10:30), angka (3.500.000), singkatan (dll.),
//      kata camelCase (iPhone), isi code/pre, dan teks tombol.
//
// Matiin: global.richAutoPolish = false di settings.js. Cuma dipake .autorich;
// .buildrich manual TETEP apa adanya (teks ketikan kamu gak diubah).
// ═══════════════════════════════════════════════════════════════════════

import config from '../../config.js';

const enabled = () => config.rich?.autoPolish !== false;

// ───────────────────────── 1. TATA LETAK MARKUP ─────────────────────────

const CODE_LINE_RE = /^(CD|P)(H|L|CC|C|F)?\(/;
const NEED_BLANK_BEFORE_RE = /^(EX\(|F\(|BF\(|BQF\(|D$|B[PSD]?\()/;
const FOOTER_OR_BUTTON_RE = /^(F\(|BF\(|BQF\(|CDF\(|PF\(|B[PSD]?\()/;

function tidyMarkup(markup) {
  const raw = String(markup == null ? '' : markup);
  if (!enabled()) return raw;

  let lines = raw.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));

  // sisa markdown di baris teks (baris CD/P dilewatin: isinya memang teks apa adanya)
  lines = lines.map((l) => {
    const t = l.trim();
    if (!t || CODE_LINE_RE.test(t)) return t;
    return t.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/, '').trim();
  });

  // baris kosong: maks 1 berurutan; wajib ada sebelum EX / F / tombol / D
  const spaced = [];
  for (const line of lines) {
    if (!line) {
      if (spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');
      continue;
    }
    if (NEED_BLANK_BEFORE_RE.test(line) && spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');
    spaced.push(line);
  }

  // divider: buang yang di awal, dobel, atau tepat sebelum footer/tombol/akhir
  const nonBlankIdx = spaced.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  const drop = new Set();
  let prevKept = null;
  for (let k = 0; k < nonBlankIdx.length; k++) {
    const i = nonBlankIdx[k];
    if (spaced[i] !== 'D') { prevKept = spaced[i]; continue; }
    const next = k + 1 < nonBlankIdx.length ? spaced[nonBlankIdx[k + 1]] : null;
    if (prevKept === null || prevKept === 'D' || next === null || FOOTER_OR_BUTTON_RE.test(next)) {
      drop.add(i);
      continue;
    }
    prevKept = 'D';
  }
  const kept = spaced.filter((_, i) => !drop.has(i));

  // rapihin blank lagi (abis buang D bisa ada blank dobel / di ujung)
  const out = [];
  for (const line of kept) {
    if (!line) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// ───────────────────────── 2. TATA BACA TEKS ─────────────────────────

// Token yang gak boleh diubah: diganti placeholder dulu, dibalikin di akhir.
const PROTECT_RE = new RegExp([
  '\\{\\d{5,}\\|[^{}|]+\\}',                            // marker emoji premium
  '(?:https?:\\/\\/|www\\.)[^\\s)]+',                   // URL
  '(?:t\\.me|telegram\\.me)\\/[^\\s)]+',                // link telegram tanpa skema
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',    // email
  '@[A-Za-z0-9_]{3,}',                                  // @username
  '#[\\p{L}\\p{N}_]+',                                  // #hashtag
  '\\b\\d{1,2}[:.]\\d{2}\\b',                           // jam 10:30 / 10.30
  '\\d+(?:[.,]\\d+)+',                                  // angka 3.500.000 / 2,5
  '\\p{L}+(?:\\.\\p{L}+){2,}\\.?',                      // e.g. / a.b.c
].join('|'), 'gu');

// Singkatan yang titiknya gak boleh dibuang / gak bikin kapital setelahnya.
const ABBR = new Set(['dll', 'dsb', 'dst', 'dkk', 'tsb', 'yg', 'dgn', 'spt', 'hlm', 'no', 'tgl', 'jl', 'jln', 'rp', 'mis', 'dr', 'prof', 'ir', 'sdr', 'bpk', 'ibu', 'pt', 'cv', 'st', 'sbb', 'kec', 'kab', 'kel', 'dsn', 'ttd', 'cth', 'ket', 'hp', 'wa', 'vs', 'etc', 'mr', 'mrs', 'ms']);

const LEAD_SKIP_RE = /^(?:\u0001\d+\u0001|\s|[▎"'“‘(\[«¿¡]|\p{Extended_Pictographic}\uFE0F?|\d+[.)]\s)*/u;

function lastWordOf(s) {
  const m = /([\p{L}\p{N}]+)\.?\s*$/u.exec(s);
  return m ? m[1] : '';
}

function isAbbrev(word) {
  if (!word) return false;
  if (ABBR.has(word.toLowerCase())) return true;
  if (/^\p{L}$/u.test(word)) return true;   // inisial "A."
  if (/^\d+$/.test(word)) return true;      // "no. 5", "1."
  return false;
}

/**
 * @param {string} str
 * @param {'heading'|'label'|'sentence'} kind
 * @param {boolean} isFirst bagian pertama dari teks block (buat kapitalisasi)
 * @param {boolean} isLast  bagian terakhir dari teks block (buat tanda baca akhir)
 */
function polishString(str, kind, isFirst = true, isLast = true) {
  const store = [];
  let t = String(str == null ? '' : str).replace(PROTECT_RE, (m) => {
    store.push(m);
    return `\u0001${store.length - 1}\u0001`;
  });

  // spasi
  t = t.replace(/[\t ]+/g, ' ');
  t = t.replace(/\s+([,.!?;:])(?![\p{L}\p{N}])/gu, '$1');
  // tanda baca berulang
  t = t.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?').replace(/,{2,}/g, ',').replace(/\.{2,}/g, '...');
  // spasi setelah tanda baca
  t = t.replace(/([,;!?])(?=\p{L})/gu, '$1 ');
  t = t.replace(/(\p{L}):(?=\p{L})/gu, '$1: ');
  t = t.replace(/(\p{Ll}{2,})\.(?=\p{Lu})/gu, '$1. ');

  if (kind !== 'sentence' && isFirst) t = t.replace(/^(?:[•·▪◦*]|-)\s+/, '');
  t = t.trim();

  // awal kalimat sesudah titik / ! / ? (paragraf & kutipan doang)
  if (kind === 'sentence') {
    t = t.replace(/([.!?])(\s+)(\p{Ll})/gu, (m, p, sp, ch, offset, whole) => {
      if (p === '.' && (whole[offset - 1] === '.' || isAbbrev(lastWordOf(whole.slice(0, offset))))) return m;
      return p + sp + ch.toUpperCase();
    });
  }

  // huruf pertama kapital (kecuali camelCase / nama file / perintah)
  if (isFirst) {
    const lead = LEAD_SKIP_RE.exec(t)[0].length;
    const rest = t.slice(lead);
    const w = /^[\p{L}\p{N}]+/u.exec(rest);
    if (w && /^\p{Ll}/u.test(w[0])) {
      const follow = rest.slice(w[0].length, w[0].length + 2);
      const camel = /\p{Lu}/u.test(w[0].slice(1));
      const fileOrCmd = /^[._/]\p{L}/u.test(follow);
      if (!camel && !fileOrCmd) t = t.slice(0, lead) + rest[0].toUpperCase() + rest.slice(1);
    }
  }

  // tanda baca akhir
  if (isLast) {
    if (kind === 'heading' || kind === 'label') {
      const chars = kind === 'heading' ? /\s*[.:;,]+$/ : /\s*[.;,]+$/;
      if (!/(\.\.\.|…)$/.test(t) && chars.test(t)) {
        const before = t.replace(chars, '');
        const endsDot = /\.$/.test(t);
        if (!(endsDot && isAbbrev(lastWordOf(before)))) t = before;
      }
    } else if (kind === 'sentence') {
      const visibleEnd = t.slice(-1);
      const endsPlaceholder = /\u0001\d+\u0001$/.test(t);
      const endsEmoji = /\p{Extended_Pictographic}\uFE0F?$/u.test(t);
      if (t.length >= 20 && /[\p{L}\p{N})\]"'”]/u.test(visibleEnd) && !endsPlaceholder && !endsEmoji) t += '.';
    }
  }

  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => store[Number(i)]);
}

// Teks block bisa string atau array segmen [{ type:'bold'|'code', text }, 'teks', ...].
// Segmen `code` gak disentuh.
function polishText(text, kind) {
  if (typeof text === 'string') return polishString(text, kind, true, true);
  if (!Array.isArray(text)) return text;
  const idx = [];
  text.forEach((seg, i) => {
    if (typeof seg === 'string') idx.push(i);
    else if (seg && seg.type !== 'code' && typeof seg.text === 'string') idx.push(i);
  });
  if (!idx.length) return text;
  return text.map((seg, i) => {
    const pos = idx.indexOf(i);
    if (pos < 0) return seg;
    const first = pos === 0;
    const last = pos === idx.length - 1;
    if (typeof seg === 'string') return polishString(seg, kind, first, last);
    return { ...seg, text: polishString(seg.text, kind, first, last) };
  });
}

function polishBlock(b, inList) {
  if (!b || typeof b !== 'object') return b;
  const copy = { ...b };
  switch (b.type) {
    case 'heading': copy.text = polishText(b.text, 'heading'); break;
    case 'paragraph': copy.text = polishText(b.text, inList ? 'label' : 'sentence'); break;
    case 'expandable_blockquote': copy.text = polishText(b.text, inList ? 'label' : 'sentence'); break;
    case 'blockquote':
      if (Array.isArray(b.blocks)) copy.blocks = b.blocks.map((x) => polishBlock(x, inList));
      else copy.text = polishText(b.text, inList ? 'label' : 'sentence');
      break;
    case 'footer': copy.text = polishText(b.text, 'sentence'); break;
    case 'table':
      copy.cells = (b.cells || []).map((row) => row.map((c) => (c && c.text != null ? { ...c, text: polishText(c.text, 'label') } : c)));
      break;
    case 'list':
      copy.items = (b.items || []).map((it) => (it && Array.isArray(it.blocks) ? { ...it, blocks: it.blocks.map((x) => polishBlock(x, true)) } : it));
      break;
    case 'details':
      copy.summary = polishText(b.summary, 'heading');
      copy.blocks = (b.blocks || []).map((x) => polishBlock(x, false));
      break;
    default: break; // pre, divider, buttons, photo, dll: apa adanya
  }
  return copy;
}

function polishBlocks(blocks) {
  if (!enabled()) return blocks;
  return (blocks || []).map((b) => polishBlock(b, false));
}

export { tidyMarkup, polishBlocks, polishString };

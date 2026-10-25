// ═══════════════════════════════════════════════════════════════════════
// FORMAT WELCOME / GOODBYE
//
// Mengubah teks yang diketik admin (lengkap dengan format bawaan Telegram: bold, italic, underline,
// coret, spoiler, kutipan, kutipan lipat, code, pre, link, emoji premium) menjadi template yang
// disimpan di database, lalu mengirimnya sebagai pesan biasa atau Rich Message, lengkap dengan tombol.
//
// Yang didukung di teks:
//   • Format Telegram (entity) -> HTML. Bisa juga membalas pesan berformat dengan "/welcome set".
//   • Variabel: {name} {first} {last} {username} {mention} {group} {count} {id} {date} {time}
//   • Tombol link (satu baris = satu baris tombol):
//       B(Teks,link)  BP(...) biru  BS(...) hijau  BD(...) merah   (beberapa per baris = sejajar)
//       [Teks](buttonurl://link)  dan  [Teks](buttonurl://link:same)  (gaya Rose)
//   • Markup Rich Message (sama seperti /buildrich), tiap elemen 1 baris:
//       H(judul)  D  T(judul tabel)+(sel)(sel)  EX(judul)+isi  L(item)+(item)  C(..)/CC(..)  F(catatan)
//       BQ(kutipan)  CD(code)  P(pre)
//     Kalau ada minimal satu baris markup, pesan dikirim sebagai Rich Message (otomatis kembali ke
//     pesan biasa bila Telegram menolak).
// ═══════════════════════════════════════════════════════════════════════
import { sendRich } from "./rich.js";

export const MAX_TEXT = 2500; // panjang teks mentah
const MAX_HTML = 3500; // panjang HTML hasil (batas pesan Telegram 4096)
const MAX_BUTTONS = 12;
const MAX_PER_ROW = 4;

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s = "") => esc(s).replace(/"/g, "&quot;");
const plainOf = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.title || "User";
const mention = (id, name) => `<a href="tg://user?id=${id}">${esc(name || "User")}</a>`;

// ── Entity -> HTML ────────────────────────────────────────────────────────
const SIMPLE = {
  bold: ["<b>", "</b>"], italic: ["<i>", "</i>"], underline: ["<u>", "</u>"], strikethrough: ["<s>", "</s>"],
  spoiler: ["<tg-spoiler>", "</tg-spoiler>"], code: ["<code>", "</code>"],
};

function tagsFor(e, expandable) {
  if (SIMPLE[e.type]) return SIMPLE[e.type];
  switch (e.type) {
    case "pre": return e.language ? [`<pre><code class="language-${escAttr(e.language)}">`, "</code></pre>"] : ["<pre>", "</pre>"];
    case "blockquote": return ["<blockquote>", "</blockquote>"];
    case "expandable_blockquote": return [expandable ? "<blockquote expandable>" : "<blockquote>", "</blockquote>"];
    case "text_link": return e.url ? [`<a href="${escAttr(e.url)}">`, "</a>"] : null;
    case "text_mention": return e.user?.id ? [`<a href="tg://user?id=${e.user.id}">`, "</a>"] : null;
    case "custom_emoji": return e.custom_emoji_id ? [`<tg-emoji emoji-id="${escAttr(e.custom_emoji_id)}">`, "</tg-emoji>"] : null;
    default: return null; // url, mention, hashtag, bot_command, dst: sudah otomatis jadi link oleh Telegram
  }
}

/**
 * Teks + entity Telegram -> HTML Bot API untuk rentang [from, to).
 * Entity yang saling tumpang tindih ditutup & dibuka ulang supaya HTML tetap valid.
 */
export function entitiesToHtml(text, entities = [], from = 0, to = text.length, opts = {}) {
  const expandable = opts.expandable !== false;
  const list = [];
  for (const e of entities || []) {
    if (!e || !(e.length > 0)) continue;
    const tg = tagsFor(e, expandable);
    if (!tg) continue;
    const s = Math.max(e.offset, from);
    const t = Math.min(e.offset + e.length, to);
    if (t > s) list.push({ s, t, open: tg[0], close: tg[1] });
  }
  list.sort((a, b) => a.s - b.s || b.t - a.t); // yang lebih panjang = lapisan luar

  const pts = [...new Set([from, to, ...list.flatMap((x) => [x.s, x.t])])].sort((a, b) => a - b);
  const stack = [];
  let out = "";
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (k > 0) out += esc(text.slice(pts[k - 1], p));
    const idx = stack.findIndex((x) => x.t <= p);
    if (idx >= 0) {
      const tail = stack.splice(idx);
      for (let i = tail.length - 1; i >= 0; i--) out += tail[i].close;
      for (const x of tail) {
        if (x.t > p) { out += x.open; stack.push(x); } // dibuka ulang
      }
    }
    for (const x of list) {
      if (x.s === p) { out += x.open; stack.push(x); }
    }
  }
  while (stack.length) out += stack.pop().close;
  return out;
}

// ── Potong / pangkas teks bersama entity-nya ─────────────────────────────
/** Ambil rentang [from, to) dan geser entity-nya (entity yang keluar rentang dipotong / dibuang) */
export function sliceText(text, entities, from, to = text.length) {
  const out = [];
  for (const e of entities || []) {
    if (!e || !(e.length > 0)) continue;
    const s = Math.max(e.offset, from);
    const t = Math.min(e.offset + e.length, to);
    if (t > s) out.push({ ...e, offset: s - from, length: t - s });
  }
  return { text: text.slice(from, to), entities: out };
}

function trimText(text, entities) {
  const lead = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  if (end <= lead) return { text: "", entities: [] };
  return sliceText(text, entities, lead, end);
}

/** Buang rentang [start, end) dari teks; entity ikut digeser / dipotong */
function cutRange(text, entities, start, end) {
  const d = end - start;
  const out = [];
  for (const e of entities || []) {
    const s0 = e.offset;
    const t0 = e.offset + e.length;
    const s = s0 < start ? s0 : s0 >= end ? s0 - d : start;
    const t = t0 <= start ? t0 : t0 >= end ? t0 - d : start;
    if (t > s) out.push({ ...e, offset: s, length: t - s });
  }
  return { text: text.slice(0, start) + text.slice(end), entities: out };
}

// ── Tombol ────────────────────────────────────────────────────────────────
const BTN_STYLES = { D: "danger", P: "primary", S: "success" };

function normalizeUrl(raw) {
  let l = String(raw || "").trim();
  if (!l) return null;
  if (/^@[A-Za-z0-9_]{4,}$/.test(l)) return `https://t.me/${l.slice(1)}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(l) && /^[^\s/?#]+\.[a-z]{2,}([/?#]|$)/i.test(l)) l = `https://${l}`;
  return /^(https?|tg):\/\/\S+$/i.test(l) ? l : null;
}

// Koma pemisah teks & link = koma pertama yang DIIKUTI link; kalau tidak ada, koma terakhir.
function splitTextLink(inner) {
  const m = inner.match(/,\s*(?=(?:https?:\/\/|tg:\/\/|t\.me\/|telegram\.me\/|www\.|@))/i);
  const idx = m ? m.index : inner.lastIndexOf(",");
  if (idx < 0) return null;
  return [inner.slice(0, idx).trim(), inner.slice(idx + 1).trim()];
}

const LOOKS_BUTTON = /^(?:B[DPS]?\(|\[[^\]]+\]\(buttonurl:)/;
const ROSE_RE = /\[([^[\]]+)\]\(buttonurl:(?:\/\/)?([^)\s]+)\)/y;

/**
 * Satu baris -> { tokens:[{text,url,style,newRow}] } | { error } | null (bukan baris tombol).
 * Baris tombol hanya boleh berisi token tombol (spasi antar token boleh).
 */
function parseButtonLine(line, lineNo) {
  const s = line.trim();
  if (!LOOKS_BUTTON.test(s)) return null;
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const m = /^B([DPS]?)\(/.exec(s.slice(i));
    if (m) {
      const open = i + m[0].length - 1;
      let depth = 0;
      let j = open;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")" && --depth === 0) break;
      }
      if (depth !== 0) return { error: `Baris ${lineNo}: tanda kurung tombol tidak tertutup.` };
      const parts = splitTextLink(s.slice(open + 1, j));
      if (!parts || !parts[0] || !parts[1]) return { error: `Baris ${lineNo}: format tombol harus ${m[0]}teks,link) — teks dan link tidak boleh kosong.` };
      const url = normalizeUrl(parts[1]);
      if (!url) return { error: `Baris ${lineNo}: link tombol "${parts[1].slice(0, 40)}" tidak valid (pakai https://, t.me/, tg:// atau @username).` };
      const lead = s.slice(open + 1).length - s.slice(open + 1).trimStart().length;
      const tk = { text: parts[0], url, style: BTN_STYLES[m[1]], newRow: tokens.length === 0, ts: open + 1 + lead };
      const mk = /^\{(\d{5,})\|[^{}|]+\}\s*([\s\S]*)$/.exec(parts[0]); // ikon premium eksplisit: B({ID|👑} OWNER,link)
      if (mk && mk[2].trim()) { tk.text = mk[2].trim(); tk.icon_custom_emoji_id = mk[1]; delete tk.ts; }
      tokens.push(tk);
      i = j + 1;
      continue;
    }
    ROSE_RE.lastIndex = i;
    const r = ROSE_RE.exec(s);
    if (r) {
      let link = r[2];
      const same = /:same$/i.test(link);
      if (same) link = link.replace(/:same$/i, "");
      const url = normalizeUrl(link);
      if (!url) return { error: `Baris ${lineNo}: link tombol "${link.slice(0, 40)}" tidak valid.` };
      tokens.push({ text: r[1].trim(), url, newRow: !same, ts: i + 1 });
      i = ROSE_RE.lastIndex;
      continue;
    }
    return { error: `Baris ${lineNo}: di baris tombol hanya boleh B(..) / BP(..) / BS(..) / BD(..) atau [Teks](buttonurl://link), ada teks nyasar: "${s.slice(i, i + 15)}"` };
  }
  return { tokens, lead: line.length - line.trimStart().length };
}

/** Pisahkan baris tombol dari teks. Balikin { text, entities, rows } atau { error } */
function extractButtons(text, entities) {
  const lines = text.split("\n");
  const offsets = [];
  let pos = 0;
  for (const l of lines) { offsets.push(pos); pos += l.length + 1; }

  const found = []; // { idx, tokens }
  for (let i = 0; i < lines.length; i++) {
    const r = parseButtonLine(lines[i], i + 1);
    if (!r) continue;
    if (r.error) return { error: r.error };
    found.push({ idx: i, tokens: r.tokens, lead: r.lead || 0 });
  }

  const rows = [];
  for (const f of found) {
    for (const tk of f.tokens) {
      // Emoji premium yang diketik langsung di awal teks tombol -> ikon tombol (icon_custom_emoji_id)
      if (tk.ts != null && !tk.icon_custom_emoji_id) {
        const abs = offsets[f.idx] + f.lead + tk.ts;
        const ce = (entities || []).find((e) => e.type === "custom_emoji" && e.custom_emoji_id && e.offset === abs);
        if (ce && tk.text.length > ce.length) { tk.text = tk.text.slice(ce.length).trim(); tk.icon_custom_emoji_id = ce.custom_emoji_id; }
      }
      delete tk.ts;
      const { newRow, ...btn } = tk;
      if (newRow || !rows.length) rows.push([btn]);
      else rows[rows.length - 1].push(btn);
    }
  }
  const total = rows.reduce((n, r) => n + r.length, 0);
  if (total > MAX_BUTTONS) return { error: `Terlalu banyak tombol (${total}), maksimal ${MAX_BUTTONS}.` };
  if (rows.some((r) => r.length > MAX_PER_ROW)) return { error: `Maksimal ${MAX_PER_ROW} tombol dalam satu baris.` };

  let cur = { text, entities };
  for (const f of [...found].reverse()) {
    const start = offsets[f.idx];
    const end = Math.min(start + lines[f.idx].length + 1, cur.text.length);
    cur = cutRange(cur.text, cur.entities, start, end);
  }
  return { ...cur, rows };
}

// ── Markup Rich Message (H / D / T / EX / L / C / CC / F / BQ / CD / P) ──
const MARKUP_LINE = /^(?:(?:H|T|EX|L|CC?|F|BQ|CD|P)\(.*\)|D)$/;

/** "KW(isi)" -> isi | null. kwLen = panjang keyword */
function wrapped(html, kwLen) {
  if (html[kwLen] !== "(" || !html.endsWith(")")) return null;
  return html.slice(kwLen + 1, -1).trim();
}

/** "(a)(b) (c)" -> ["a","b","c"] (kurung bersarang yang seimbang boleh) | { error } */
function parseCells(str) {
  const cells = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    if (/\s/.test(str[i])) { i++; continue; }
    if (str[i] !== "(") return { error: `ada teks di luar tanda kurung: "${plainOf(str.slice(i, i + 15))}"` };
    let depth = 0;
    let j = i;
    let inTag = false;
    for (; j < n; j++) {
      const c = str[j];
      if (c === "<") inTag = true;
      else if (c === ">") inTag = false;
      else if (inTag) continue;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    if (depth !== 0) return { error: "tanda kurung tidak tertutup" };
    cells.push(str.slice(i + 1, j).trim());
    i = j + 1;
  }
  return { cells };
}

const isSingleBlock = (html, tag) => {
  const re = new RegExp(`^<${tag}\\b[^>]*>[\\s\\S]*</${tag}>$`, "i");
  return re.test(html) && (html.match(new RegExp(`<${tag}\\b`, "gi")) || []).length === 1;
};
const unwrapBlock = (html, tag) => html.replace(new RegExp(`^<${tag}\\b[^>]*>`, "i"), "").replace(new RegExp(`</${tag}>$`, "i"), "");
const flatBlocks = (html) => html.replace(/<\/?(?:blockquote|pre)\b[^>]*>/gi, "");

const startsBlock = (l) => !!l.plain && (MARKUP_LINE.test(l.plain) || isSingleBlock(l.html, "blockquote") || isSingleBlock(l.html, "pre"));

function buildRich(text, entities) {
  const lines = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.trimEnd().length;
    const s = pos + lead;
    const e = pos + Math.max(trail, lead);
    lines.push({ html: entitiesToHtml(text, entities, s, e), plain: raw.trim() });
    pos += raw.length + 1;
  }

  const R = []; // Rich HTML
  const G = []; // HTML biasa (cadangan)
  let para = [];
  let quote = [];
  let pre = [];
  const flush = () => {
    if (para.length) { R.push(`<p>${para.join("<br>")}</p>`); G.push(para.join("\n")); para = []; }
    if (quote.length) { R.push(`<blockquote>${quote.join("<br>")}</blockquote>`); G.push(`<blockquote>${quote.join("\n")}</blockquote>`); quote = []; }
    if (pre.length) { R.push(`<pre>${pre.join("\n")}</pre>`); G.push(`<pre>${pre.join("\n")}</pre>`); pre = []; }
  };

  let i = 0;
  while (i < lines.length) {
    const { html, plain } = lines[i];
    if (!plain) { flush(); i++; continue; }
    let t;

    if (plain === "D") { flush(); R.push("<hr/>"); G.push("──────────"); i++; continue; }

    if (/^H\(/.test(html) && (t = wrapped(html, 1))) { flush(); R.push(`<h2>${t}</h2>`); G.push(`<b>${t}</b>`); i++; continue; }

    if (/^F\(/.test(html) && (t = wrapped(html, 1))) { flush(); R.push(`<p><i>${t}</i></p>`); G.push(`<i>${t}</i>`); i++; continue; }

    if (/^BQ\(/.test(html) && (t = wrapped(html, 2))) { flush(); R.push(`<blockquote>${t}</blockquote>`); G.push(`<blockquote>${t}</blockquote>`); i++; continue; }

    if (/^CD\(/.test(html) && (t = wrapped(html, 2))) {
      flush();
      const p = esc(plainOf(t));
      R.push(`<p><code>${p}</code></p>`); G.push(`<code>${p}</code>`); i++; continue;
    }

    if (/^P\(/.test(html) && wrapped(html, 1)) {
      flush();
      const rows = [];
      while (i < lines.length && /^P\(/.test(lines[i].html) && (t = wrapped(lines[i].html, 1))) { rows.push(esc(plainOf(t))); i++; }
      R.push(`<pre>${rows.join("\n")}</pre>`); G.push(`<pre>${rows.join("\n")}</pre>`);
      continue;
    }

    if (/^T\(/.test(html)) {
      const head = parseCells(html.slice(1));
      if (head.error) return { error: `Baris ${i + 1}: ${head.error}.` };
      const rows = [head.cells];
      i++;
      while (i < lines.length && lines[i].html.startsWith("(")) {
        const r = parseCells(lines[i].html);
        if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
        rows.push(r.cells);
        i++;
      }
      flush();
      const maxCols = Math.max(...rows.map((r) => r.length));
      const cell = (tag, c, ri, ci, row) => `<${tag}${ci === row.length - 1 && row.length < maxCols ? ` colspan="${maxCols - row.length + 1}"` : ""}>${c}</${tag}>`;
      R.push(`<table bordered striped>${rows.map((row, ri) => `<tr>${row.map((c, ci) => cell(ri === 0 ? "th" : "td", c, ri, ci, row)).join("")}</tr>`).join("")}</table>`);
      G.push(rows.map((row, ri) => (ri === 0 ? `<b>${row.join(" │ ")}</b>` : row.join(" │ "))).join("\n"));
      continue;
    }

    if (/^EX\(/.test(html) && (t = wrapped(html, 2)) !== null) {
      if (!t) return { error: `Baris ${i + 1}: format EX(judul) — judulnya tidak boleh kosong.` };
      flush();
      const inner = [];
      i++;
      while (i < lines.length && lines[i].plain) { inner.push(lines[i].html); i++; }
      if (!inner.length) return { error: `Baris ${i}: EX(${plainOf(t)}) butuh minimal satu baris isi tepat di bawahnya.` };
      R.push(`<details><summary><b>${t}</b></summary><p>${inner.map(flatBlocks).join("<br>")}</p></details>`);
      G.push(`<blockquote expandable><b>${t}</b>\n${inner.map(flatBlocks).join("\n")}</blockquote>`);
      continue;
    }

    if (/^L\(/.test(html) && (t = wrapped(html, 1))) {
      const items = [t];
      i++;
      while (i < lines.length && lines[i].html.startsWith("(")) {
        const r = parseCells(lines[i].html);
        if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
        items.push(...r.cells.filter(Boolean));
        i++;
      }
      flush();
      R.push(`<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
      G.push(items.map((x) => `• ${x}`).join("\n"));
      continue;
    }

    if (/^CC?\(/.test(html) && (t = wrapped(html, html.startsWith("CC(") ? 2 : 1))) {
      const items = [];
      while (i < lines.length && /^CC?\(/.test(lines[i].html)) {
        const checked = lines[i].html.startsWith("CC(");
        const first = wrapped(lines[i].html, checked ? 2 : 1);
        if (!first) break;
        items.push({ t: first, checked });
        i++;
        while (i < lines.length && lines[i].html.startsWith("(")) {
          const r = parseCells(lines[i].html);
          if (r.error) return { error: `Baris ${i + 1}: ${r.error}.` };
          for (const c of r.cells.filter(Boolean)) items.push({ t: c, checked });
          i++;
        }
      }
      flush();
      R.push(`<ul>${items.map((x) => `<li><input type="checkbox"${x.checked ? " checked" : ""}>${x.t}</li>`).join("")}</ul>`);
      G.push(items.map((x) => `${x.checked ? "☑" : "☐"} ${x.t}`).join("\n"));
      continue;
    }

    // Baris kutipan / pre bawaan Telegram (format biasa)
    if (isSingleBlock(html, "blockquote")) {
      if (para.length || pre.length) flush();
      quote.push(unwrapBlock(html, "blockquote")); i++; continue;
    }
    if (isSingleBlock(html, "pre")) {
      if (para.length || quote.length) flush();
      pre.push(esc(plainOf(unwrapBlock(html, "pre")))); i++; continue;
    }

    // Paragraf biasa
    if (quote.length || pre.length) flush();
    para.push(html);
    i++;
    while (i < lines.length && lines[i].plain && !startsBlock(lines[i])) { para.push(lines[i].html); i++; }
  }
  flush();

  return { rich: autolink(R.join("")), legacy: G.join("\n\n") };
}

// Link http(s) polos jadi <a> (di luar tag / <a> / <code> / <pre>) — Rich Message tidak membuatnya otomatis
function autolink(html) {
  const parts = html.split(/(<[^>]*>)/);
  let skip = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) {
      const m = /^<\s*(\/?)\s*(a|pre|code)\b/i.exec(parts[i]);
      if (m) skip = Math.max(0, skip + (m[1] ? -1 : 1));
      continue;
    }
    if (skip) continue;
    parts[i] = parts[i].replace(/\bhttps?:\/\/[^\s<>"'{}]+[^\s<>"'{}.,;:!?)\]]/g, (u) => `<a href="${u}">${u}</a>`);
  }
  return parts.join("");
}

// ── Kompilasi template ────────────────────────────────────────────────────
/**
 * Teks + entity -> template siap simpan.
 * @returns {{ error: string } | { tpl: { v: 2, rich: string|null, legacy: string, buttons: Array<Array<{text,url,style?}>> } }}
 */
export function compileTemplate(rawText, rawEntities = []) {
  let cur = trimText(String(rawText || ""), rawEntities);
  if (!cur.text) return { error: "Teksnya kosong." };
  if (cur.text.length > MAX_TEXT) return { error: `Teks terlalu panjang (${cur.text.length} karakter, maksimal ${MAX_TEXT}).` };

  const btn = extractButtons(cur.text, cur.entities);
  if (btn.error) return { error: btn.error };
  cur = trimText(btn.text, btn.entities);
  if (!cur.text) return { error: "Tambahkan teks pesannya, tidak cukup hanya tombol." };

  const isRich = cur.text.split("\n").some((l) => MARKUP_LINE.test(l.trim()));
  let rich = null;
  let legacy;
  if (isRich) {
    const b = buildRich(cur.text, cur.entities);
    if (b.error) return { error: b.error };
    rich = b.rich;
    legacy = b.legacy;
  } else {
    legacy = entitiesToHtml(cur.text, cur.entities);
  }
  if (legacy.length > MAX_HTML || (rich && rich.length > MAX_HTML)) return { error: "Hasil format terlalu panjang. Persingkat teksnya." };
  return { tpl: { v: 2, rich, legacy, buttons: btn.rows } };
}

/** Ringkasan template (untuk /welcome status): teks polos pendek */
export const previewText = (tpl, max = 280) => {
  const t = plainOf(String(tpl?.legacy || "")).replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const describeTemplate = (tpl) => {
  const n = (tpl.buttons || []).reduce((a, r) => a + r.length, 0);
  return `${tpl.rich ? "Rich Message" : "teks berformat"}${n ? ` · ${n} tombol` : ""}`;
};

// ── Variabel ──────────────────────────────────────────────────────────────
const VAR_RE = /\{(name|first|last|username|mention|group|count|id|date|time)\}/gi;
export const VAR_LIST = "{name} {first} {last} {username} {mention} {group} {count} {id} {date} {time}";

const TZ = "Asia/Jakarta";
const fmt = (opts, d) => { try { return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, ...opts }).format(d); } catch { return ""; } };

/** Siapkan nilai variabel untuk satu atau beberapa member (maks 5 nama ditampilkan, sisanya "dan N lainnya") */
export function makeVars(members, { group = "", count = "" } = {}) {
  const shown = members.slice(0, 5);
  const extra = members.length - shown.length;
  const tail = extra > 0 ? ` dan ${extra} lainnya` : "";
  const join = (arr) => (arr.length ? arr.join(", ") + tail : "");
  const now = new Date();
  const plain = {
    name: join(shown.map(fullName)),
    first: join(shown.map((u) => u.first_name || fullName(u))),
    last: join(shown.map((u) => u.last_name).filter(Boolean)),
    username: join(shown.map((u) => (u.username ? `@${u.username}` : "")).filter(Boolean)),
    group: String(group ?? ""),
    count: String(count ?? ""),
    id: shown.map((u) => u.id).join(", "),
    date: fmt({ dateStyle: "long" }, now),
    time: fmt({ timeStyle: "short" }, now),
  };
  plain.mention = plain.name;
  const html = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, esc(v)]));
  html.mention = shown.map((u) => mention(u.id, fullName(u))).join(", ") + tail;
  return { plain, html };
}

/** Isi variabel di HTML template. {mention} di dalam link / code / pre jadi nama biasa (tag <a> tidak boleh bersarang). */
export function applyVars(html, vars) {
  const parts = String(html).split(/(<[^>]*>)/);
  let noLink = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2) {
      const m = /^<\s*(\/?)\s*(a|pre|code)\b/i.exec(p);
      if (m) noLink = Math.max(0, noLink + (m[1] ? -1 : 1));
      if (/^<a\b/i.test(p)) {
        parts[i] = p.replace(VAR_RE, (x, k) => {
          k = k.toLowerCase();
          const v = vars.plain[k];
          if (v == null) return x;
          return escAttr(k === "id" ? v.split(",")[0].trim() : encodeURIComponent(v)); // di URL: id pertama saja
        });
      }
      continue;
    }
    parts[i] = p.replace(VAR_RE, (x, k) => {
      k = k.toLowerCase();
      if (k === "mention" && noLink) return vars.html.name;
      return vars.html[k] ?? x;
    });
  }
  return parts.join("");
}

const applyPlain = (s, vars) => String(s).replace(VAR_RE, (x, k) => vars.plain[k.toLowerCase()] ?? x);

// ── Kirim ─────────────────────────────────────────────────────────────────
/**
 * Kirim template ke chat tempat ctx berada (membalas pesan tertentu hanya kalau opts.replyTo diisi).
 * Rich Message bila template berisi markup rich; selain itu pesan HTML biasa (otomatis dirapikan lapisan Rich Reply).
 * Melempar error bila Telegram menolak semua bentuk.
 */
export async function sendTemplate(ctx, tpl, vars, opts = {}) {
  const chatId = ctx.chat.id;
  const legacy = applyVars(tpl.legacy, vars);
  const rich = tpl.rich ? applyVars(tpl.rich, vars) : null;
  const rows = (tpl.buttons || []).map((row) =>
    row.map((b) => ({ text: applyPlain(b.text, vars).slice(0, 64) || "Link", url: b.url, ...(b.style ? { style: b.style } : {}), ...(b.icon_custom_emoji_id ? { icon_custom_emoji_id: b.icon_custom_emoji_id } : {}) }))
  );
  const thread = ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  // opts.replyTo = message_id yang dibalas (mis. pesan pemicu filter); kosong = kirim biasa
  const replyTo = opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {};

  const send = (withStyle) => {
    const markup = rows.length ? { inline_keyboard: withStyle ? rows : rows.map((r) => r.map(({ style, ...b }) => b)) } : null;
    const extra = { ...(markup ? { reply_markup: markup } : {}), ...thread, ...replyTo, ...(opts.exact ? { exact_emoji: true } : {}) };
    if (rich) return sendRich(ctx.telegram, chatId, { rich, legacy }, extra);
    return ctx.telegram.sendMessage(chatId, legacy, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  };

  try {
    return await send(true);
  } catch (e) {
    // Server lama bisa menolak warna tombol: coba lagi tanpa warna
    if (rows.some((r) => r.some((b) => b.style)) && /style|button|reply_markup/i.test(e?.message || "")) return send(false);
    throw e;
  }
}

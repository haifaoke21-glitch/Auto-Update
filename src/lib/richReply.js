// ═══════════════════════════════════════════════════════════════════════
// RICH REPLY — SEMUA balasan teks fitur otomatis jadi Rich Message (Bot API 10.1+).
//
// Cara kerja: installRichReply(bot) membungkus bot.telegram.callApi. Setiap sendMessage / editMessageText
// (ctx.reply, ctx.editMessageText, replyWithHTML, replyWithMarkdown, telegram.sendMessage, dst.) diubah jadi
// sendRichMessage / editMessageText { rich_message: { html } } dengan tampilan rapi:
//   • baris pertama berupa judul         -> <h2> judul
//   • beberapa baris "Label: nilai"      -> tabel 2 kolom (Info | Detail)
//   • pesan satu baris (❌ ✅ ⚠️ ⏳ dst)  -> kartu blockquote
//   • sisanya                            -> paragraf, blockquote & <pre> dipertahankan
// Plugin lama TIDAK perlu diubah. Emoji biasa otomatis jadi emoji premium oleh lib/premiumEmoji.js
// (wrapper ini dipasang SETELAH premiumEmoji, jadi payload rich ikut dikonversi emoji premiumnya).
//
// Aman: bila Telegram menolak (server belum support Rich Message, HTML ditolak, dll) pesan otomatis dikirim
// ulang dalam bentuk aslinya, jadi tidak ada balasan yang hilang. Beberapa kegagalan beruntun -> Rich Message
// dijeda 10 menit supaya bot tidak melambat.
//
// Tidak diubah (tetap teks biasa): caption foto/video/dokumen (Telegram tidak punya rich untuk caption),
// pesan dengan MarkdownV2, pesan yang meminta link preview, dan pesan dengan opsi khusus (silent, protect, dll).
//
// Matikan: config.js -> richReply: false
// ═══════════════════════════════════════════════════════════════════════
import config from "../../config.js";
import { legacyMarkdownToHtml } from "./premiumEmoji.js";

const MAX_HTML = 3800; // lebih panjang dari ini dikirim apa adanya
const MAX_CARD = 350; // pesan 1 baris sependek ini jadi kartu blockquote
const MAX_TITLE = 60;
const FAIL_LIMIT = 5; // gagal beruntun -> jeda
const PAUSE_MS = 10 * 60_000;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const plain = (html) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const enabled = () => config.richReply !== false;

// ── Entities (teks polos berformat) -> HTML ─────────────────────────────
function wrapEntity(e, inner, raw) {
  switch (e.type) {
    case "bold": return `<b>${inner}</b>`;
    case "italic": return `<i>${inner}</i>`;
    case "underline": return `<u>${inner}</u>`;
    case "strikethrough": return `<s>${inner}</s>`;
    case "spoiler": return `<tg-spoiler>${inner}</tg-spoiler>`;
    case "code": return `<code>${inner}</code>`;
    case "pre": return `<pre>${inner}</pre>`;
    case "blockquote":
    case "expandable_blockquote": return `<blockquote>${inner}</blockquote>`;
    case "text_link": return `<a href="${escAttr(e.url)}">${inner}</a>`;
    case "text_mention": return e.user?.id ? `<a href="tg://user?id=${e.user.id}">${inner}</a>` : inner;
    case "url": return `<a href="${escAttr(raw)}">${inner}</a>`;
    case "custom_emoji": return `<tg-emoji emoji-id="${escAttr(e.custom_emoji_id)}">${inner}</tg-emoji>`;
    default: return inner;
  }
}

function renderEntities(text, ents, from, to) {
  let out = "";
  let pos = from;
  let i = 0;
  while (i < ents.length) {
    const e = ents[i];
    if (e.offset < pos) { i++; continue; } // tumpang tindih sebagian: lewati
    out += esc(text.slice(pos, e.offset));
    const end = Math.min(e.offset + e.length, to);
    const inner = [];
    let j = i + 1;
    while (j < ents.length && ents[j].offset < end) {
      inner.push({ ...ents[j], length: Math.min(ents[j].length, end - ents[j].offset) });
      j++;
    }
    out += wrapEntity(e, renderEntities(text, inner, e.offset, end), text.slice(e.offset, end));
    pos = end;
    i = j;
  }
  return out + esc(text.slice(pos, to));
}

function entitiesToHtml(text, entities) {
  const ents = (entities || []).filter((e) => e && e.length > 0).sort((a, b) => a.offset - b.offset || b.length - a.length);
  return renderEntities(text, ents, 0, text.length);
}

// ── Normalisasi sumber (plain / Markdown lama / HTML) -> HTML ─────────────
const TAG_ALIAS = [[/<(\/?)strong\b/gi, "<$1b"], [/<(\/?)em\b/gi, "<$1i"], [/<(\/?)ins\b/gi, "<$1u"], [/<(\/?)(?:strike|del)\b/gi, "<$1s"]];

function sourceToHtml(data) {
  const text = data.text;
  const mode = String(data.parse_mode || "");
  if (/^markdownv2$/i.test(mode)) return null;
  if (/^markdown$/i.test(mode)) return legacyMarkdownToHtml(text);
  if (/^html$/i.test(mode)) return TAG_ALIAS.reduce((s, [re, to]) => s.replace(re, to), text);
  if (mode) return null;
  return Array.isArray(data.entities) && data.entities.length ? entitiesToHtml(text, data.entities) : esc(text);
}

// Link http(s) polos jadi <a> (di luar tag / <a> / <code> / <pre>)
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
    parts[i] = parts[i].replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, (u) => `<a href="${u}">${u}</a>`);
  }
  return parts.join("");
}

// Seimbangkan tag: tutup yang menggantung, buang penutup nyasar
function balance(html) {
  const stack = [];
  let out = "";
  for (const part of html.split(/(<[^>]*>)/)) {
    const m = /^<\s*(\/?)\s*([a-z][\w-]*)/i.exec(part);
    if (!m || /\/\s*>$/.test(part)) { out += part; continue; }
    const tag = m[2].toLowerCase();
    if (!m[1]) { stack.push(tag); out += part; }
    else if (stack[stack.length - 1] === tag) { stack.pop(); out += part; }
    else if (stack.includes(tag)) {
      while (stack.length && stack[stack.length - 1] !== tag) out += `</${stack.pop()}>`;
      stack.pop(); out += part;
    } // penutup nyasar dibuang
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

// ── Penyusun blok ────────────────────────────────────────────────────────
const BULLET = /^(?:[•▪▫◦·*]|[-–—]|\d{1,2}[.)])\s+/u;
const LEAD_EMOJI = /^(?:<[^>]*>)*\s*\p{Extended_Pictographic}/u;
const USAGE = /^(?:contoh|format|gunakan|penggunaan|cara pakai|cara|usage|ketik)\b/i;

/** "Label: nilai" -> [labelHtml, valueHtml] atau null */
function splitKV(line) {
  const s = line.replace(BULLET, "");
  let inTag = false;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<") { inTag = true; continue; }
    if (c === ">") { inTag = false; continue; }
    if (inTag) continue;
    if (c === ":" || c === "：") {
      const label = s.slice(0, i);
      const rest = s.slice(i + 1);
      const lead = rest.replace(/^(?:<\/[^>]+>)*/, "");
      const lp = plain(label).trim();
      if (!lp || /[/]|https?|\bwww\./i.test(lp) || lp.length > 36) return null;
      if (!/^\s/.test(lead) || !plain(lead).trim()) return null;
      return [balance(label).trim(), balance(lead).trim()];
    }
    if (++n > 40) return null;
  }
  return null;
}

const table = (rows) =>
  `<table bordered striped><tr><th>Info</th><th>Detail</th></tr>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>`;

const brJoin = (lines) => lines.map((l) => l.replace(/^[-–—*]\s+/, "• ")).join("<br>");

function unwrapBold(html) {
  const m = /^<b>([\s\S]*)<\/b>$/i.exec(html.trim());
  return m && !/<\/?b>/i.test(m[1]) ? m[1] : html;
}

function isTitle(line, boldWrapped) {
  const p = plain(line).trim();
  if (!p || p.length > MAX_TITLE || /[.,;]$/.test(p) || splitKV(line)) return false;
  return boldWrapped || LEAD_EMOJI.test(line);
}

function paragraphToHtml(lines, allowTitle) {
  const out = [];
  let rest = lines;
  if (allowTitle) {
    const bold = /^<b>[\s\S]*<\/b>$/i.test(lines[0].trim()) && !/<\/?b>/i.test(lines[0].trim().slice(3, -4));
    if (isTitle(lines[0], bold) && (lines.length > 1 || allowTitle === "more")) {
      out.push(`<h2>${unwrapBold(lines[0]).replace(/\s*[:：]\s*$/, "")}</h2>`);
      rest = lines.slice(1);
    }
  }
  if (!rest.length) return out;

  let head = null;
  let body = rest;
  if (body.length > 2 && /[:：]\s*(?:<\/[^>]+>)*$/.test(body[0]) && !splitKV(body[0])) { head = body[0]; body = body.slice(1); }
  const kv = body.map(splitKV);
  if (body.length >= 2 && kv.every(Boolean)) {
    if (head) out.push(`<p>${head}</p>`);
    out.push(table(kv));
  } else {
    out.push(`<p>${brJoin(rest)}</p>`);
  }
  return out;
}

export function toRichHtml(html) {
  const segs = html.split(/(<pre[\s\S]*?<\/pre>|<blockquote[^>]*>[\s\S]*?<\/blockquote>)/i);
  const hasBlocks = segs.length > 1;
  const textOnly = segs.length === 1;
  const flat = html.trim();

  // Pesan 1 baris pendek -> kartu blockquote
  if (textOnly && !flat.includes("\n") && plain(flat).length <= MAX_CARD) {
    const card = USAGE.test(plain(flat)) && !LEAD_EMOJI.test(flat) ? `ℹ️ ${flat}` : flat;
    return `<blockquote>${autolink(card)}</blockquote>`;
  }

  const out = [];
  let first = true;
  segs.forEach((seg, idx) => {
    if (idx % 2) {
      out.push(/^<blockquote/i.test(seg) ? seg.replace(/\n/g, "<br>") : seg);
      first = false;
      return;
    }
    const paras = seg.split(/\n{2,}/).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean)).filter((p) => p.length);
    for (const lines of paras) {
      const more = hasBlocks || paras.length > 1 ? "more" : true;
      out.push(...paragraphToHtml(lines, first ? more : false));
      first = false;
    }
  });
  return autolink(out.join(""));
}

// ── Pengubah payload ─────────────────────────────────────────────────────
const SEND_KEYS = new Set(["chat_id", "text", "parse_mode", "entities", "link_preview_options", "disable_web_page_preview", "reply_markup", "reply_parameters", "message_thread_id"]);
const EDIT_KEYS = new Set(["chat_id", "message_id", "text", "parse_mode", "entities", "link_preview_options", "disable_web_page_preview", "reply_markup"]);

function previewWanted(d) {
  const l = d.link_preview_options;
  if (d.disable_web_page_preview === false) return true;
  return !!l && l.is_disabled !== true;
}

/** @returns {{method:string,data:object}|null} null = kirim apa adanya */
export function convertPayload(method, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const isSend = method === "sendMessage";
  if (!isSend && method !== "editMessageText") return null;
  if (typeof data.text !== "string" || !data.text.trim() || data.rich_message || data.inline_message_id) return null;
  const allowed = isSend ? SEND_KEYS : EDIT_KEYS;
  if (Object.keys(data).some((k) => !allowed.has(k))) return null;
  if (previewWanted(data)) return null;

  const src = sourceToHtml(data);
  if (src == null) return null;
  const html = toRichHtml(src);
  if (!html || html.length > MAX_HTML) return null;

  const out = {};
  for (const k of ["chat_id", "message_id", "reply_markup", "reply_parameters", "message_thread_id"]) if (data[k] !== undefined) out[k] = data[k];
  out.rich_message = { html };
  return { method: isSend ? "sendRichMessage" : "editMessageText", data: out };
}

// ── Pemasangan ───────────────────────────────────────────────────────────
const FATAL = /forbidden|blocked|chat not found|can't initiate|not enough rights|too many requests|deactivated/i;
const NO_METHOD = /unknown method|method not found|not found: method/i;
const NOT_MODIFIED = /not modified/i;
const errText = (e) => `${e?.response?.description || ""} ${e?.message || ""}`;

/** Pasang ke satu instance Telegraf. Panggil SETELAH installPremiumEmoji. Aman dipanggil berkali-kali. */
export function installRichReply(bot) {
  const tg = bot?.telegram;
  if (!tg || tg.__richReply || !enabled()) return false;
  const orig = tg.callApi.bind(tg);
  let fails = 0;
  let pausedUntil = 0;

  tg.callApi = async function callApi(method, data, ...rest) {
    if ((method !== "sendMessage" && method !== "editMessageText") || Date.now() < pausedUntil) return orig(method, data, ...rest);
    let conv = null;
    try {
      conv = convertPayload(method, data);
    } catch (e) {
      console.error("[RICHREPLY] gagal konversi, dikirim apa adanya:", e.message);
    }
    if (!conv) return orig(method, data, ...rest);
    try {
      const res = await orig(conv.method, conv.data, ...rest);
      fails = 0;
      return res;
    } catch (e) {
      const msg = errText(e);
      if (NOT_MODIFIED.test(msg) || FATAL.test(msg)) throw e;
      if (NO_METHOD.test(msg)) pausedUntil = Number.MAX_SAFE_INTEGER; // server tidak mengenal Rich Message
      else if (++fails >= FAIL_LIMIT) { pausedUntil = Date.now() + PAUSE_MS; fails = 0; console.warn("[RICHREPLY] gagal beruntun, Rich Message dijeda 10 menit"); }
      console.warn(`[RICHREPLY] ${method} ditolak (${msg.trim().slice(0, 120)}); kirim ulang teks biasa.`);
      return orig(method, data, ...rest);
    }
  };
  tg.__richReply = true;
  return true;
}

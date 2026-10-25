// ═══════════════════════════════════════════════════════════════════════
// BACA RICH MESSAGE YANG DITERIMA BOT
//
// Dipakai /welcome set, /goodbye set & /filter saat membalas Rich Message (mis. buatan bot lain).
// Tujuan: mengubahnya jadi HTML Rich Message supaya variabel {mention} {name} {group} {count} dst bisa
// diganti. Bentuk data yang dikenali (Telegram bisa mengirim salah satunya):
//   • string HTML                              rich_message = "<h1>..</h1>"
//   • objek dengan field html/text/content     rich_message = { html: "..." }
//   • objek / array block                      rich_message = { blocks: [ {type:"heading",...} ] }
// Mengembalikan null kalau tidak terbaca / berisi media (supaya disalin utuh seperti sebelumnya).
// ═══════════════════════════════════════════════════════════════════════

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s = "") => esc(s).replace(/"/g, "&quot;");

const WRAP = { bold: "b", italic: "i", underline: "u", strikethrough: "s", code: "code", spoiler: "tg-spoiler" };

const isEid = (x) => x != null && /^\d{5,}$/.test(String(x));
/** ID emoji premium dari satu node RichText (nama field bisa beda-beda: custom_emoji_id / emoji_id / document_id / custom_emoji{...}) */
function emojiIdOf(t) {
  const c = t.custom_emoji ?? (t.emoji && typeof t.emoji === "object" ? t.emoji : null);
  const cands = [
    t.custom_emoji_id, t.emoji_id, t.document_id,
    c && typeof c === "object" ? (c.custom_emoji_id ?? c.emoji_id ?? c.document_id ?? c.id) : c,
    t.type === "custom_emoji" || t.type === "emoji" ? t.id : null,
  ];
  const hit = cands.find(isEid);
  return hit != null ? String(hit) : null;
}

/** RichText (string | objek | array) -> HTML inline */
function textHtml(t) {
  if (t == null) return "";
  if (typeof t === "string") return esc(t);
  if (Array.isArray(t)) return t.map(textHtml).join("");
  if (typeof t === "object") {
    const eid = emojiIdOf(t);
    if (eid) {
      const alt = t.alternative_text || (typeof t.emoji === "string" && !/^\d+$/.test(t.emoji) ? t.emoji : "") || (typeof t.text === "string" ? t.text : "") || "⭐";
      return `<tg-emoji emoji-id="${escAttr(eid)}">${esc(alt)}</tg-emoji>`;
    }
    const inner = textHtml(t.text ?? t.parts ?? t.children ?? "");
    const tag = WRAP[t.type];
    if (tag) return `<${tag}>${inner}</${tag}>`;
    if ((t.type === "text_link" || t.type === "link" || t.type === "url") && t.url) return `<a href="${escAttr(t.url)}">${inner}</a>`;
    return inner;
  }
  return esc(String(t));
}

class Unsupported extends Error {}

function blockHtml(b) {
  if (!b || typeof b !== "object") throw new Unsupported("block");
  switch (b.type) {
    case "heading": return `<h${Math.min(Math.max(Number(b.level) || 1, 1), 4)}>${textHtml(b.text)}</h${Math.min(Math.max(Number(b.level) || 1, 1), 4)}>`;
    case "paragraph": return `<p>${textHtml(b.text)}</p>`;
    case "blockquote": return `<blockquote>${textHtml(b.text ?? (b.blocks || []).map((x) => textHtml(x.text)).join("\n"))}</blockquote>`;
    case "expandable_blockquote": return `<blockquote expandable>${textHtml(b.text ?? (b.blocks || []).map((x) => textHtml(x.text)).join("\n"))}</blockquote>`;
    case "pre": return `<pre>${esc(typeof b.text === "string" ? b.text : textHtml(b.text))}</pre>`;
    case "divider": return "<hr/>";
    case "footer": return `<i>${textHtml(b.text)}</i>`;
    case "table": {
      const rows = (b.cells || b.rows || []).map((row, i) => `<tr>${(row || []).map((c) => {
        const th = c && typeof c === "object" ? (c.is_header ?? i === 0) : i === 0;
        const tag = th ? "th" : "td";
        const span = c && typeof c === "object" ? Number(c.colspan || c.col_span || 0) : 0;
        const al = c && typeof c === "object" && c.align && c.align !== "left" ? ` align="${escAttr(c.align)}"` : "";
        return `<${tag}${span > 1 ? ` colspan="${span}"` : ""}${al}>${textHtml(c?.text ?? c)}</${tag}>`;
      }).join("")}</tr>`);
      return `<table${b.is_bordered === false ? "" : " bordered"}${b.is_striped ? " striped" : ""}>${rows.join("")}</table>`;
    }
    case "details": {
      const summary = Array.isArray(b.summary) ? b.summary.map((s) => textHtml(s?.text ?? s)).join("") : textHtml(b.summary);
      return `<details><summary>${summary}</summary>${(b.blocks || []).map(blockHtml).join("")}</details>`;
    }
    case "list": {
      const items = (b.items || []).map((it) => `<li>${(it.blocks || []).map((p) => textHtml(p.text)).join(" ") || textHtml(it.text)}</li>`);
      return `<ul>${items.join("")}</ul>`;
    }
    case "buttons": return ""; // tombol dibaca dari reply_markup
    default: throw new Unsupported(b.type || "?"); // foto / video / audio / dll -> salin utuh
  }
}

/** Ambil HTML Rich Message dari objek pesan Telegram. null bila tidak terbaca atau berisi media. */
export function readRichHtml(msg) {
  const rm = msg?.rich_message ?? msg?.rich_text ?? msg?.rich;
  if (rm == null) return null;
  let html = null;
  try {
    if (typeof rm === "string") html = rm;
    else if (Array.isArray(rm)) html = rm.map(blockHtml).join("");
    else if (typeof rm === "object") {
      for (const k of ["html", "text", "content", "body"]) {
        if (typeof rm[k] === "string" && /<\w/.test(rm[k])) { html = rm[k]; break; }
      }
      if (html == null && Array.isArray(rm.blocks)) html = rm.blocks.map(blockHtml).join("");
    }
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
  html = typeof html === "string" ? html.trim() : null;
  return html || null;
}

// ═══════════════════════════════════════════════════════════════════════
// FILTER GRUP — inti (parser, pencocok, pengirim). Tidak menyentuh database supaya mudah dites.
//
// Satu filter = kata kunci -> balasan otomatis. Balasannya bisa:
//   • teks, dengan format Telegram (tebal, miring, kutipan, spoiler, code, link, emoji premium), Rich Message
//     (H(..), T(..), EX(..), dst), tombol (B(..), BS(..), ...) dan variabel ({mention} {name} {group} ...)
//     — aturannya sama persis dengan /welcome (lihat greetingFormat.js)
//   • media: foto, video, GIF, file, stiker, audio, voice note, video bulat (+ teks/caption berformat)
// ═══════════════════════════════════════════════════════════════════════
import config from "../../config.js";
import { readRichHtml } from "./richRead.js";
import { allOwnerIds } from "../middleware.js";
import { compileTemplate, sliceText, sendTemplate, makeVars, applyVars, describeTemplate } from "./greetingFormat.js";

export const MAX_FILTERS = 100;
export const MAX_KEY = 60;
const CAPTION_MAX = 1000; // batas Telegram 1024, sisakan ruang

// jenis media -> nama tampil, method Bot API
export const MEDIA_LABEL = {
  photo: "foto", video: "video", animation: "GIF", document: "file",
  audio: "audio", voice: "voice note", sticker: "stiker", video_note: "video bulat",
  copy: "salinan pesan",
};
const SEND_METHOD = {
  photo: "sendPhoto", video: "sendVideo", animation: "sendAnimation", document: "sendDocument",
  audio: "sendAudio", voice: "sendVoice", sticker: "sendSticker", video_note: "sendVideoNote",
};
const HAS_CAPTION = new Set(["photo", "video", "animation", "document", "audio", "voice"]);
const HAS_SPOILER = new Set(["photo", "video", "animation"]);

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Parser perintah ───────────────────────────────────────────────────────
/**
 * Baca kata kunci mulai dari indeks `from`. Satu kata, atau beberapa kata dalam tanda kutip: "selamat pagi".
 * @returns {null | { error: string } | { key: string, end: number, quoted: boolean }}
 */
export function parseKeyword(raw, from = 0) {
  let i = from;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (i >= raw.length) return null;

  let key;
  let end;
  let quoted = false;
  const q = raw[i];
  if (q === '"' || q === "“" || q === "”") {
    const closers = q === '"' ? ['"', "”"] : ["”", "“", '"'];
    let j = i + 1;
    while (j < raw.length && !closers.includes(raw[j])) j++;
    if (j >= raw.length) return { error: "Tanda kutip penutup kata kunci tidak ditemukan." };
    key = raw.slice(i + 1, j);
    end = j + 1;
    quoted = true;
  } else {
    let j = i;
    while (j < raw.length && !/\s/.test(raw[j])) j++;
    key = raw.slice(i, j);
    end = j;
  }
  key = key.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return { error: "Kata kunci tidak boleh kosong." };
  if (key.length > MAX_KEY) return { error: `Kata kunci terlalu panjang (maksimal ${MAX_KEY} karakter).` };
  return { key, end, quoted };
}

/** Media dari sebuah pesan (GIF dicek sebelum file karena pesan GIF juga membawa field document) */
export function mediaOf(msg) {
  if (!msg) return null;
  if (msg.photo?.length) return { type: "photo", fileId: msg.photo[msg.photo.length - 1].file_id, spoiler: !!msg.has_media_spoiler };
  if (msg.animation) return { type: "animation", fileId: msg.animation.file_id, spoiler: !!msg.has_media_spoiler };
  if (msg.video) return { type: "video", fileId: msg.video.file_id, spoiler: !!msg.has_media_spoiler };
  if (msg.document) return { type: "document", fileId: msg.document.file_id, spoiler: false };
  if (msg.audio) return { type: "audio", fileId: msg.audio.file_id, spoiler: false };
  if (msg.voice) return { type: "voice", fileId: msg.voice.file_id, spoiler: false };
  if (msg.sticker) return { type: "sticker", fileId: msg.sticker.file_id, spoiler: false };
  if (msg.video_note) return { type: "video_note", fileId: msg.video_note.file_id, spoiler: false };
  return null;
}

/** HTML Rich Message dari pesan (Rich Message yang dikirim bot lain tidak punya text/caption). null bila tidak ada / tidak bisa dipakai. */
function richHtmlOf(msg) {
  const html = readRichHtml(msg);
  if (!html) return null;
  if (/<(img|audio|video|iframe|tg-slideshow)\b/i.test(html)) return null; // berisi media: lebih aman disalin utuh
  return html.trim();
}
const htmlToLegacy = (html) =>
  html.replace(/<(?:br|\/p|\/h\d|\/tr|\/li|\/summary)[^>]*>/gi, "\n").replace(/<\/t[dh]>/gi, " │ ").replace(/<(?!\/?(?:b|i|u|s|code|pre|a|tg-spoiler|tg-emoji|blockquote)\b)[^>]+>/gi, "").replace(/\n{3,}/g, "\n\n").trim();

const fixUrl = (u) => {
  let l = String(u || "").trim();
  if (!l) return null;
  if (/^@[A-Za-z0-9_]{4,}$/.test(l)) l = `https://t.me/${l.slice(1)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(l) && /^[^\s/?#]+\.[a-z]{2,}([/?#]|$)/i.test(l)) l = `https://${l}`;
  return /^(https?|tg):\/\/\S+$/i.test(l) ? l : null;
};
/** URL tombol: url biasa, login_url, atau web_app (semuanya tombol link) */
const urlOfButton = (b) => fixUrl(b?.url || b?.login_url?.url || b?.web_app?.url);

/** Tombol link (URL) pada pesan yang dibalas -> baris tombol (teks, link, warna, ikon premium). Tombol non-link (callback dll) dilewati. */
function buttonsOf(msg) {
  const rows = [];
  for (const row of msg?.reply_markup?.inline_keyboard || []) {
    const r = [];
    for (const b of row) {
      const url = urlOfButton(b);
      if (b?.text && url) {
        r.push({
          text: String(b.text).slice(0, 64), url,
          ...(b.style ? { style: b.style } : {}),
          ...(b.icon_custom_emoji_id ? { icon_custom_emoji_id: String(b.icon_custom_emoji_id) } : {}),
        });
      }
    }
    if (r.length) rows.push(r.slice(0, 4));
  }
  return rows.slice(0, 6);
}

/** Data asli pesan yang dibalas (Rich Message + tombol) disimpan utuh supaya bisa dikirim ulang persis sama */
function rawOf(msg) {
  const rm = msg?.rich_message;
  if (rm == null || (typeof rm !== "object" && typeof rm !== "string")) return null;
  let rich;
  try { rich = JSON.parse(JSON.stringify(rm)); } catch { return null; }
  if (JSON.stringify(rich).length > 60000) return null;
  const markup = [];
  for (const row of msg?.reply_markup?.inline_keyboard || []) {
    const r = [];
    for (const b of row) {
      const url = urlOfButton(b);
      if (!b?.text || !url) continue;
      const { callback_data, switch_inline_query, switch_inline_query_current_chat, switch_inline_query_chosen_chat, callback_game, pay, copy_text, ...keep } = b;
      r.push({ ...keep, url, ...(keep.login_url ? { login_url: undefined } : {}), ...(keep.web_app ? { web_app: undefined } : {}) });
    }
    if (r.length) markup.push(r.slice(0, 8));
  }
  return { rich, markup: JSON.parse(JSON.stringify(markup)) };
}

/**
 * Pesan /filter -> { key, entry } | { usage: true } | { error }.
 * Sumber isi (urutan): teks setelah kata kunci -> media/teks pesan yang dibalas.
 * Perintah di caption media (kirim foto/video/file dengan caption "/filter kata ...") juga didukung.
 */
export function buildEntry(msg) {
  const raw = msg.text ?? msg.caption ?? "";
  const ents = msg.entities ?? msg.caption_entities ?? [];
  const cmd = /^\S+/.exec(raw);
  const pk = parseKeyword(raw, cmd ? cmd[0].length : 0);
  if (!pk) return { usage: true };
  if (pk.error) return { error: pk.error };

  const rest = sliceText(raw, ents, pk.end);
  const reply = msg.reply_to_message;
  const ownMedia = mediaOf(msg);
  const media = ownMedia || mediaOf(reply);

  let src = rest.text.trim() ? rest : null;
  let fromReply = !ownMedia && !!reply && !!mediaOf(reply);
  if (!src && !ownMedia && reply) {
    const rt = reply.text ?? reply.caption;
    if (rt && rt.trim()) { src = { text: rt, entities: reply.entities ?? reply.caption_entities ?? [] }; fromReply = true; }
  }
  // Pesan yang dibalas tanpa teks/media biasa (mis. Rich Message dari bot lain): pakai HTML-nya, atau salin pesan aslinya
  if (!media && !src && reply) {
    const html = richHtmlOf(reply);
    const buttons = buttonsOf(reply);
    const raw = rawOf(reply);
    const from = { chat: reply.chat?.id ?? msg.chat?.id, id: reply.message_id };
    if (html) {
      const legacy = htmlToLegacy(html);
      if (legacy.length <= 3500 && html.length <= 3500) {
        return { key: pk.key, entry: { type: "text", fileId: null, spoiler: false, tpl: { v: 2, rich: html, legacy, buttons }, src: from, ...(raw ? { raw } : {}), by: msg.from?.id ?? null, at: Date.now() } };
      }
    }
    if (reply.rich_message) { // bantu diagnosa: bentuk rich_message yang diterima bot (kalau tidak terbaca, hasilnya jadi salinan tanpa variabel)
      const rm = reply.rich_message;
      console.warn("[GREETING] rich_message tidak bisa dibaca sebagai HTML -> disimpan sebagai salinan. Bentuk:", (() => { try { return JSON.stringify(rm).slice(0, 800); } catch { return String(rm); } })());
    }
    if (from.chat != null && from.id != null && !reply.new_chat_members && !reply.left_chat_member && !reply.pinned_message) {
      return { key: pk.key, entry: { type: "copy", fileId: null, spoiler: false, tpl: buttons.length ? { v: 2, rich: null, legacy: "", buttons } : null, src: from, ...(raw ? { raw } : {}), by: msg.from?.id ?? null, at: Date.now() } };
    }
  }
  if (!media && !src) {
    return reply
      ? { error: "Pesan yang dibalas tidak bisa dipakai. Yang didukung: teks, foto, video, GIF, file, stiker, audio, voice note, video bulat." }
      : { usage: true };
  }

  let tpl = null;
  if (src) {
    const c = compileTemplate(src.text, src.entities);
    if (c.error) return { error: c.error };
    tpl = c.tpl;
  }
  // Pesan yang dibalas membawa tombol link -> ikut disalin (tombol yang diketik di /filter dipakai dulu; total maks 12)
  if (reply && !ownMedia) {
    const copied = buttonsOf(reply);
    const own = tpl?.buttons || [];
    if (copied.length && !own.length) {
      if (!tpl) tpl = { v: 2, rich: null, legacy: "", buttons: copied };
      else tpl = { ...tpl, buttons: copied };
    }
  }
  return {
    key: pk.key,
    entry: { type: media ? media.type : "text", fileId: media?.fileId || null, spoiler: !!media?.spoiler, tpl, ...(fromReply ? { exact: true } : {}), by: msg.from?.id ?? null, at: Date.now() },
  };
}

/** Ringkasan satu filter: "foto · Rich Message · 2 tombol" */
export function describeEntry(entry) {
  const parts = [];
  if (entry.type !== "text") parts.push(MEDIA_LABEL[entry.type] || entry.type);
  if (entry.tpl && !entry.tpl.rich && !String(entry.tpl.legacy || "").trim()) {
    const n = (entry.tpl.buttons || []).reduce((a, r) => a + r.length, 0);
    parts.push(`${n} tombol`);
  } else if (entry.tpl) parts.push(describeTemplate(entry.tpl));
  if (entry.raw?.rich != null) parts.push("pesan asli");
  return parts.join(" · ") || "teks";
}

// ── Pencocok ──────────────────────────────────────────────────────────────
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reCache = new Map();
function reFor(key) {
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(key).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
    reCache.set(key, re);
    if (reCache.size > 500) reCache.delete(reCache.keys().next().value);
  }
  return re;
}

/** Kata kunci yang cocok dengan teks (kata utuh, tidak peka huruf besar/kecil). Kalau banyak, ambil yang terpanjang. */
export function matchFilter(filters, text) {
  if (!filters || !text) return null;
  let best = null;
  for (const key of Object.keys(filters)) {
    if (best && key.length <= best.length) continue;
    if (reFor(key).test(text)) best = key;
  }
  return best;
}

// ── Kirim ─────────────────────────────────────────────────────────────────
const VAR_RE = /\{(name|first|last|username|mention|group|count|id|date|time)\}/gi;
const applyPlain = (s, vars) => String(s).replace(VAR_RE, (x, k) => vars.plain[k.toLowerCase()] ?? x);
const visibleLength = (html) => String(html).replace(/<[^>]*>/g, "").replace(/&(?:lt|gt|quot|amp);/g, "x").length;

function buttonMarkup(tpl, vars, withStyle) {
  const rows = (tpl?.buttons || []).map((row) =>
    row.map((b) => ({ text: applyPlain(b.text, vars).slice(0, 64) || "Link", url: b.url, ...(withStyle && b.style ? { style: b.style } : {}), ...(b.icon_custom_emoji_id ? { icon_custom_emoji_id: b.icon_custom_emoji_id } : {}) }))
  );
  return rows.length ? { inline_keyboard: rows } : null;
}

/**
 * Kirim satu filter ke chat tempat ctx berada.
 *  • teks            -> sendTemplate (format / Rich Message / tombol)
 *  • media + teks biasa & muat di caption -> satu pesan media berisi caption + tombol
 *  • media + Rich Message / teks panjang / stiker / video bulat -> media dulu, lalu teksnya sebagai pesan terpisah
 * Melempar error bila Telegram menolak.
 */
export async function sendFilter(ctx, entry, { replyTo, members } = {}) {
  const tpl = entry.tpl;
  let count = "";
  if (tpl && /\{count\}/i.test(`${tpl.legacy}${tpl.rich || ""}`)) {
    count = await ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => "?");
  }
  const vars = makeVars(members?.length ? members : [ctx.from], { group: ctx.chat.title, count });
  // Pesan yang diambil dari pesan yang dibalas dikirim PERSIS: emoji biasa tidak dipaksa jadi emoji premium lain
  const exact = entry.exact === true || !!entry.raw || !!entry.src;
  const X = exact ? { exact_emoji: true } : {};

  // Pesan asli (Rich Message + tombol) dikirim ulang persis sama, hanya variabelnya yang diganti
  if (entry.raw?.rich != null) {
    try {
      return await sendRaw(ctx, entry.raw, vars, replyTo, X);
    } catch (e) {
      console.warn("[GREETING] kirim ulang Rich Message asli ditolak, pakai cadangan:", e?.description || e?.message || e);
    }
  }

  if (entry.type === "text") return sendTemplate(ctx, tpl, vars, { replyTo, exact });

  // Salinan pesan asli (Rich Message / jenis pesan lain yang tidak bisa dibaca): copyMessage + tombol link
  if (entry.type === "copy") {
    const thread = ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
    const hasStyle = (tpl?.buttons || []).some((r) => r.some((b) => b.style));
    // Sumber salinan: pesan asli, lalu arsip (entry.backups) — jadi tetap terkirim walau pesan asli dihapus
    const sources = [entry.src, ...(entry.backups || [])].filter((x) => x && x.chat != null && x.id != null);
    const go = (src, withStyle) => {
      const markup = tpl ? buttonMarkup(tpl, vars, withStyle) : null;
      return ctx.telegram.callApi("copyMessage", { chat_id: ctx.chat.id, from_chat_id: src.chat, message_id: src.id, ...(markup ? { reply_markup: markup } : {}), ...thread, ...reply, ...X });
    };
    let lastErr;
    for (const src of sources) {
      try {
        return await go(src, true);
      } catch (e) {
        if (hasStyle && /style|button|reply_markup/i.test(e?.message || "")) {
          try { return await go(src, false); } catch (e2) { lastErr = e2; continue; }
        }
        lastErr = e; // pesan sumber hilang / bot tidak bisa mengaksesnya -> coba arsip berikutnya
      }
    }
    throw lastErr || new Error("sumber pesan tidak tersedia");
  }

  // Media + Rich Message: foto dimasukkan ke dalam Rich Message supaya jadi satu pesan (kalau ditolak -> media lalu teks terpisah)
  if (entry.type === "photo" && tpl?.rich && !entry.spoiler) {
    try {
      return await sendRichPhoto(ctx, entry, tpl, vars, replyTo, X);
    } catch (e) {
      console.warn("[FILTER] Rich + foto ditolak, kirim terpisah:", e?.description || e?.message || e);
    }
  }

  const textless = Boolean(tpl && !tpl.rich && !String(tpl.legacy || "").trim()); // hanya tombol (disalin dari pesan lain)
  const caption = tpl && !tpl.rich && HAS_CAPTION.has(entry.type) && !textless ? applyVars(tpl.legacy, vars) : null;
  const inCaption = (caption !== null && visibleLength(caption) <= CAPTION_MAX) || textless;
  const thread = ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  const hasStyle = inCaption && (tpl.buttons || []).some((r) => r.some((b) => b.style));

  const attempt = (withStyle) => {
    const markup = inCaption ? buttonMarkup(tpl, vars, withStyle) : null;
    return ctx.telegram.callApi(SEND_METHOD[entry.type], {
      chat_id: ctx.chat.id,
      [entry.type]: entry.fileId,
      ...(inCaption && !textless ? { caption, parse_mode: "HTML" } : {}),
      ...(entry.spoiler && HAS_SPOILER.has(entry.type) ? { has_spoiler: true } : {}),
      ...(markup ? { reply_markup: markup } : {}),
      ...thread,
      ...reply,
      ...X,
    });
  };

  let sent;
  try {
    sent = await attempt(true);
  } catch (e) {
    // Server lama bisa menolak warna tombol: coba lagi tanpa warna
    if (hasStyle && /style|button|reply_markup/i.test(e?.message || "")) sent = await attempt(false);
    else throw e;
  }
  if (tpl && !inCaption) await sendTemplate(ctx, tpl, vars, { exact });
  return sent;
}

const SKIP_KEYS = new Set(["type", "id", "custom_emoji_id", "document_id", "file_id", "file_unique_id", "media", "style", "icon_custom_emoji_id", "emoji_id", "alternative_text"]);
/** Ganti {variabel} di semua teks data Rich Message (string HTML -> applyVars, string biasa -> teks polos) */
function substitute(v, vars, key) {
  if (typeof v === "string") {
    if (SKIP_KEYS.has(key)) return v;
    return /<[a-z!/]/i.test(v) ? applyVars(v, vars) : applyPlain(v, vars);
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, vars, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, vars, k)]));
  return v;
}

async function sendRaw(ctx, raw, vars, replyTo, X = {}) {
  const rich = substitute(raw.rich, vars);
  const thread = ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  const rows = (raw.markup || []).map((row) => row.map((b) => {
    const { url, text, ...rest } = b;
    const out = { ...rest, text: applyPlain(text, vars).slice(0, 64) || "Link", url: applyPlain(url, vars) };
    for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k];
    return out;
  })).filter((r) => r.length);
  const attempt = (withStyle) => ctx.telegram.callApi("sendRichMessage", {
    chat_id: ctx.chat.id,
    rich_message: typeof rich === "string" ? { html: rich } : rich,
    ...(rows.length ? { reply_markup: { inline_keyboard: withStyle ? rows : rows.map((r) => r.map(({ style, ...b }) => b)) } } : {}),
    ...thread,
    ...reply,
    ...X,
  });
  try {
    return await attempt(true);
  } catch (e) {
    if (rows.some((r) => r.some((b) => b.style)) && /style|button|reply_markup/i.test(e?.message || "")) return attempt(false);
    throw e;
  }
}

/** Foto + Rich Message dalam satu pesan: <img src="tg://photo?id=.."> di depan isi Rich Message, lengkap dengan tombol */
async function sendRichPhoto(ctx, entry, tpl, vars, replyTo, X = {}) {
  const html = `<img src="tg://photo?id=fphoto"/>${applyVars(tpl.rich, vars)}`;
  const media = [{ id: "fphoto", media: { type: "photo", media: entry.fileId } }];
  const thread = ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  const hasStyle = (tpl.buttons || []).some((r) => r.some((b) => b.style));
  const attempt = (withStyle) => {
    const markup = buttonMarkup(tpl, vars, withStyle);
    return ctx.telegram.callApi("sendRichMessage", { chat_id: ctx.chat.id, rich_message: { html, media }, ...(markup ? { reply_markup: markup } : {}), ...thread, ...reply, ...X });
  };
  try {
    return await attempt(true);
  } catch (e) {
    if (hasStyle && /style|button|reply_markup/i.test(e?.message || "")) return attempt(false);
    throw e;
  }
}

/**
 * Arsipkan salinan pesan "copy" supaya tetap ada walau pesan asli dihapus.
 * Pesan disalin ke chat penampung (config.greetingStore.chatId → config.backup.chatId → owner bot),
 * ditambah pesan contoh yang dikirim bot di grup. Hasilnya disimpan di entry.backups.
 */
export async function archiveEntry(ctx, entry, sample) {
  if (!entry || entry.type !== "copy" || !entry.src) return entry;
  const backups = [];
  const targets = [config.greetingStore?.chatId, config.backup?.chatId, ...allOwnerIds()].map((x) => String(x ?? "").trim()).filter(Boolean);
  for (const chat of [...new Set(targets)]) {
    try {
      const r = await ctx.telegram.callApi("copyMessage", { chat_id: chat, from_chat_id: entry.src.chat, message_id: entry.src.id });
      if (r?.message_id) { backups.push({ chat: /^-?\d+$/.test(chat) ? Number(chat) : chat, id: r.message_id }); break; }
    } catch { /* coba target berikutnya */ }
  }
  if (sample?.message_id) backups.push({ chat: ctx.chat.id, id: sample.message_id }); // contoh di grup sebagai cadangan terakhir
  return { ...entry, backups };
}

export { esc };

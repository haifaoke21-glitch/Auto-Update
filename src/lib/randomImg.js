import axios from "axios";
import config from "../../config.js";
import { escH } from "./util.js";
import { registerCallback } from "./callbacks.js";

// Helper bersama untuk kategori Random (dipakai plugins/random/*.js).
// Base URL bisa diganti di config.js:  randomApi: "https://api.nexray.eu.cc/random"
export const BASE = String(config.randomApi || "https://api.nexray.eu.cc/random").replace(/\/+$/, "");
const TIMEOUT = 30000;
const MAX_BYTES = 10 * 1024 * 1024;

// key -> { title, emoji, urls: string[] }  (URL dicoba berurutan)
export const SOURCES = new Map();
export const registerSource = (key, src) => SOURCES.set(key, src);

/** Sumber cecan per negara: /cecan/<negara>, cadangan /cecan?country=<negara> */
export const cecanUrls = (country) => [`${BASE}/cecan/${country}`, `${BASE}/cecan?country=${country}`];

const IMG_URL_RE = /^https?:\/\/\S+$/i;
function findUrl(v, depth = 0) {
  if (depth > 4 || v == null) return null;
  if (typeof v === "string") return IMG_URL_RE.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) { for (const it of v) { const f = findUrl(it, depth + 1); if (f) return f; } return null; }
  if (typeof v === "object") {
    for (const k of ["url", "image", "image_url", "result", "data", "link", "src"]) {
      if (k in v) { const f = findUrl(v[k], depth + 1); if (f) return f; }
    }
    for (const val of Object.values(v)) { const f = findUrl(val, depth + 1); if (f) return f; }
  }
  return null;
}

const get = (url) => axios.get(url, {
  responseType: "arraybuffer", timeout: TIMEOUT, maxContentLength: MAX_BYTES * 3,
  headers: { "User-Agent": "Mozilla/5.0 (AzmiStecu-MD)", Accept: "image/*,application/json;q=0.9,*/*;q=0.8" },
  validateStatus: (s) => s >= 200 && s < 300,
});

/** API boleh langsung mengembalikan gambar/video, atau JSON berisi URL media. */
async function fetchMedia(url) {
  let res = await get(url);
  let type = String(res.headers["content-type"] || "").toLowerCase();
  if (type.includes("json") || type.startsWith("text/")) {
    let body = null;
    try { body = JSON.parse(Buffer.from(res.data).toString("utf8")); } catch {}
    const mediaUrl = findUrl(body);
    if (!mediaUrl) throw new Error("respon API tidak berisi gambar");
    res = await get(mediaUrl);
    type = String(res.headers["content-type"] || "").toLowerCase();
  }
  const buffer = Buffer.from(res.data);
  if (!buffer.length) throw new Error("gambar kosong");
  if (buffer.length > MAX_BYTES) throw new Error("ukuran gambar terlalu besar");
  return { buffer, kind: type.startsWith("video/") ? "video" : type.includes("gif") ? "animation" : "photo" };
}

async function getRandom(key) {
  const src = SOURCES.get(key);
  if (!src) throw new Error("kategori tidak dikenal");
  let lastErr = null;
  for (const url of src.urls) {
    try { return await fetchMedia(url); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("API tidak merespon");
}

const againMarkup = (key) => ({ inline_keyboard: [[{ text: "🔄 Lagi", callback_data: `rnd:${key}` }]] });

export async function sendRandom(ctx, key, { replyTo } = {}) {
  const src = SOURCES.get(key);
  const { buffer, kind } = await getRandom(key);
  const extra = {
    caption: `${escH(src.emoji)} <b>${escH(src.title)}</b>`,
    parse_mode: "HTML",
    reply_markup: againMarkup(key),
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  };
  const method = kind === "video" ? "sendVideo" : kind === "animation" ? "sendAnimation" : "sendPhoto";
  try {
    return await ctx.telegram[method](ctx.chat.id, { source: buffer }, extra);
  } catch (err) {
    if (kind === "photo" && /dimension|PHOTO_|too big|wrong file/i.test(err?.message || "")) {
      return ctx.telegram.sendDocument(ctx.chat.id, { source: buffer, filename: "random.jpg" }, extra);
    }
    throw err;
  }
}

/** Jalankan satu kategori dari perintah (dengan pesan gagal yang rapi) */
export async function runRandom(ctx, key) {
  try {
    await sendRandom(ctx, key, { replyTo: ctx.message?.message_id });
  } catch (err) {
    await ctx.reply(`❌ Gagal mengambil gambar: ${escH(err.message)}\nAPI mungkin sedang bermasalah, coba lagi nanti.`, { parse_mode: "HTML" });
  }
}

// Tombol "🔄 Lagi" & pilihan negara /cecan
registerCallback("rnd", async (ctx, [key]) => {
  if (key === "x") { await ctx.answerCbQuery(); return ctx.deleteMessage().catch(() => {}); }
  if (!SOURCES.has(key)) return ctx.answerCbQuery("Kategori tidak dikenal.");
  await ctx.answerCbQuery("⏳ Mengambil gambar...");
  const msg = ctx.callbackQuery?.message;
  const isMedia = Boolean(msg?.photo || msg?.video || msg?.animation || msg?.document);
  try {
    if (isMedia) await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await sendRandom(ctx, key, { replyTo: isMedia ? msg.message_id : undefined });
  } catch (err) {
    await ctx.reply(`❌ Gagal mengambil gambar: ${escH(err.message)}\nAPI mungkin sedang bermasalah, coba lagi nanti.`, { parse_mode: "HTML" }).catch(() => {});
  }
});

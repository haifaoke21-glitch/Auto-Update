// Tombol UNDUH buildrich: tap -> bot langsung mengirim FILE-nya ke chat pribadi user yang menekan (bukan sekadar membuka link).
// Alur: DL(teks,link) di /buildrich -> block button { callback_data: "dl:<id>", dl_url } di Rich Message.
//   - URL disimpan di database/main/dlbuttons.json (callback_data maks 64 byte, jadi cuma id pendek yang dikirim)
//   - Saat ditekan: bot mengunduh file dari URL lalu mengirimnya (foto/video/dokumen) ke DM penekan; kalau DM belum bisa, ke chat tombol
//   - Kalau server menolak tombol callback di Rich Message, richSend.js otomatis memakai tombol link biasa
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { registerCallback } from "./callbacks.js";
import { maxBotApiUploadBytes } from "./net.js";

const FILE = path.join(process.cwd(), "database", "main", "dlbuttons.json");
const MAX_ITEMS = 2000;
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 15000;

let store = null;
let timer = null;

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch { store = {}; }
  store.items ||= {};
  return store;
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(store));
    } catch (e) { console.warn("[DL] gagal simpan:", e.message); }
  }, 500);
}

/** id pendek stabil dari URL (callback_data maks 64 byte) */
export const dlId = (url) => crypto.createHash("sha1").update(String(url)).digest("base64url").slice(0, 12);

export const hasDl = (blocks) => (blocks || []).some((b) => b?.type === "buttons" && (b.buttons || []).some((x) => x?.dl_url));

const mapButtons = (blocks, fn) => (blocks || []).map((b) => (b?.type === "buttons" ? { ...b, buttons: b.buttons.map(fn) } : b));

/** Tombol unduh sebagai tombol callback (buang field internal dl_url sebelum dikirim ke Telegram) */
export const toCallbackBlocks = (blocks) => mapButtons(blocks, (btn) => {
  if (!btn?.dl_url) return btn;
  const { dl_url, ...rest } = btn;
  return rest;
});

/** Cadangan: tombol unduh jadi tombol link biasa (dibuka di browser) */
export const toUrlBlocks = (blocks) => mapButtons(blocks, (btn) => {
  if (!btn?.dl_url) return btn;
  const { dl_url, callback_data, ...rest } = btn;
  return { ...rest, url: dl_url };
});

/** Simpan semua URL tombol unduh yang akan dikirim */
export function registerDlButtons(blocks) {
  const db = load();
  const now = Date.now();
  let changed = false;
  for (const b of blocks || []) {
    if (b?.type !== "buttons") continue;
    for (const btn of b.buttons || []) {
      if (!btn?.dl_url) continue;
      db.items[dlId(btn.dl_url)] = { url: btn.dl_url, at: now };
      changed = true;
    }
  }
  if (!changed) return;
  const keys = Object.keys(db.items);
  for (const k of keys) if (now - (db.items[k].at || 0) > TTL_MS) delete db.items[k];
  const left = Object.entries(db.items);
  if (left.length > MAX_ITEMS) left.sort((a, b) => a[1].at - b[1].at).slice(0, left.length - MAX_ITEMS).forEach(([k]) => delete db.items[k]);
  save();
}

function pickFilename(headers, url) {
  const cd = String(headers?.["content-disposition"] || "");
  let name = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd)?.[1] || /filename="?([^";]+)"?/i.exec(cd)?.[1] || "";
  if (!name) {
    try { name = new URL(url).pathname.split("/").filter(Boolean).pop() || ""; } catch {}
  }
  try { name = decodeURIComponent(name); } catch {}
  name = name.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 120);
  return name || "file";
}

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lastTap = new Map(); // "userId:id" -> waktu

const FORBIDDEN = /forbidden|blocked|can't initiate|chat not found|user is deactivated/i;
const IMG = /\.(jpe?g|png|webp)$/i;
const VID = /\.(mp4|mov|m4v)$/i;
const PHOTO_MAX = 10 * 1024 * 1024; // batas sendPhoto Bot API

/**
 * Kirim file sesuai jenisnya supaya aplikasi Telegram user bisa menyimpannya dengan benar:
 *  - gambar (jpg/png/webp, <=10 MB) -> foto  | video (mp4/mov/m4v) -> video  => bisa masuk Galeri
 *    (otomatis kalau "Simpan ke Galeri" aktif di Pengaturan Telegram, atau lewat menu ⋮ > Simpan ke Galeri)
 *  - selain itu -> dokumen => tersimpan ke folder Download/File HP (menu ⋮ > Simpan ke Unduhan)
 * Kalau Telegram menolak sebagai foto/video (dimensi/codec), otomatis jatuh ke dokumen.
 */
async function deliver(telegram, chatId, buf, filename, extra) {
  const file = { source: buf, filename };
  const opts = { caption: `⬇️ ${filename}`.slice(0, 200), ...extra };
  if (IMG.test(filename) && buf.length <= PHOTO_MAX) {
    try { return await telegram.sendPhoto(chatId, file, opts); } catch (e) { if (FORBIDDEN.test(e?.message || "")) throw e; }
  }
  if (VID.test(filename)) {
    try { return await telegram.sendVideo(chatId, file, { ...opts, supports_streaming: true }); } catch (e) { if (FORBIDDEN.test(e?.message || "")) throw e; }
  }
  return telegram.sendDocument(chatId, file, opts);
}

registerCallback("dl", async (ctx, [id]) => {
  const item = load().items[id];
  if (!item) return ctx.answerCbQuery("Tombol ini sudah kedaluwarsa. Minta dibuatkan ulang.", { show_alert: true });

  const key = `${ctx.from?.id}:${id}`;
  if (Date.now() - (lastTap.get(key) || 0) < COOLDOWN_MS) return ctx.answerCbQuery("File sedang dikirim, tunggu sebentar.");
  lastTap.set(key, Date.now());
  if (lastTap.size > 500) lastTap.delete(lastTap.keys().next().value);

  const chatId = ctx.chat?.id ?? ctx.from.id;
  const inGroup = ctx.chat && ctx.chat.type !== "private";
  await ctx.answerCbQuery(inGroup ? "⬇️ File dikirim ke chat pribadimu dengan bot. Belum masuk? Buka chat bot lalu tekan Start." : "⬇️ Mengunduh file...").catch(() => {});

  const msg = ctx.callbackQuery?.message;
  const chatExtra = {
    ...(msg?.message_id ? { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } } : {}),
    ...(msg?.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
  };
  ctx.telegram.sendChatAction(ctx.from.id, "upload_document").catch(() => {});

  let buf;
  let filename;
  try {
    const limit = maxBotApiUploadBytes();
    const res = await axios.get(item.url, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxRedirects: 5,
      maxContentLength: limit,
      maxBodyLength: limit,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    buf = Buffer.from(res.data);
    filename = pickFilename(res.headers, item.url);
  } catch (err) {
    lastTap.delete(key);
    console.warn("[DL] gagal unduh:", err?.message);
    return ctx.telegram.sendMessage(
      chatId,
      `⚠️ Gagal mengunduh file (mungkin terlalu besar atau link tidak bisa diakses).\nUnduh manual: <a href="${esc(item.url).replace(/"/g, "&quot;")}">buka link</a>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...chatExtra }
    ).catch(() => {});
  }

  // 1) kirim ke chat PRIBADI user yang menekan (di grup) -> file masuk ke HP orang itu saja
  // 2) kalau bot belum boleh chat dengannya (belum Start), kirim di chat tempat tombol ditekan
  try {
    await deliver(ctx.telegram, ctx.from.id, buf, filename, {});
  } catch (err) {
    if (inGroup && FORBIDDEN.test(err?.message || "")) {
      try {
        await deliver(ctx.telegram, chatId, buf, filename, chatExtra);
        return;
      } catch (e2) { err = e2; }
    }
    lastTap.delete(key);
    console.warn("[DL] gagal kirim file:", err?.message);
    await ctx.telegram.sendMessage(
      chatId,
      `⚠️ Gagal mengirim file.\nUnduh manual: <a href="${esc(item.url).replace(/"/g, "&quot;")}">buka link</a>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...chatExtra }
    ).catch(() => {});
  }
});

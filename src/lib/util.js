import axios from "axios";

/** Escape karakter Markdown (legacy) agar teks user aman dikirim dengan parse_mode Markdown */
export function esc(text = "") {
  return String(text).replace(/([_*`\[])/g, "\\$1");
}

/** Escape karakter HTML (&, <, >) agar teks dinamis aman dikirim dengan parse_mode HTML */
export function escH(text = "") {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export function displayName(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Seseorang";
}

/** Target = user yang direply, kalau tidak ada = pengirim */
export function targetUser(ctx) {
  return ctx.message?.reply_to_message?.from || ctx.from;
}

export async function getJson(url, params = {}, timeout = 30000) {
  const { data } = await axios.get(url, { params, timeout });
  return data;
}

export async function getBuffer(url, timeout = 60000) {
  const { data } = await axios.get(url, { responseType: "arraybuffer", timeout });
  return Buffer.from(data);
}

/** Ambil file/foto dari pesan (langsung, caption, atau reply). Return Buffer atau null */
export async function getMediaBuffer(ctx, kinds = ["photo", "sticker", "document"]) {
  const msg = ctx.message;
  const sources = [msg, msg?.reply_to_message].filter(Boolean);
  for (const src of sources) {
    let fileId = null;
    if (kinds.includes("photo") && src.photo) fileId = src.photo.at(-1).file_id;
    else if (kinds.includes("sticker") && src.sticker && !src.sticker.is_animated && !src.sticker.is_video) fileId = src.sticker.file_id;
    else if (kinds.includes("document") && src.document?.mime_type?.startsWith("image/")) fileId = src.document.file_id;
    else if (kinds.includes("video") && (src.video || src.animation)) fileId = (src.video || src.animation).file_id;
    if (fileId) {
      const link = await ctx.telegram.getFileLink(fileId);
      return getBuffer(link.href);
    }
  }
  return null;
}

export function formatBytes(n = 0) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}

/** Cek URL sederhana */
export const isUrl = (s = "") => /^https?:\/\/\S+$/i.test(s.trim());

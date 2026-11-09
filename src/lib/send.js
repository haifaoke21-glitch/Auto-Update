import axios from "axios";
import { formatBytes, escH } from "./util.js";
import { maxUploadBytes, maxBotApiUploadBytes, isTooLargeErr } from "./net.js";
import { mtprotoEnabled, sendFileMT } from "./mtproto.js";

/**
 * Unduh URL lalu kirim ke chat sebagai video/audio/photo/document.
 * Jika terlalu besar, kirim link langsung.
 */
export async function sendFromUrl(ctx, url, type = "document", extra = {}) {
  const MAX_BYTES = maxUploadBytes(); // 49MB (server resmi) / ~1.9GB (Local Bot API)
  let size = 0;
  try {
    const head = await axios.head(url, { timeout: 15000, maxRedirects: 5 });
    size = Number(head.headers["content-length"] || 0);
  } catch {
    /* beberapa server menolak HEAD, lanjut saja */
  }
  if (size > MAX_BYTES) {
    return ctx.reply(`<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> File terlalu besar untuk dikirim bot (${escH(formatBytes(size))}).\nUnduh manual:\n${escH(url)}`, { parse_mode: "HTML" });
  }

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    maxRedirects: 5,
    headers: { "User-Agent": "Mozilla/5.0" },
  }).catch((err) => {
    if (isTooLargeErr(err)) return null; // ukuran tidak diketahui di awal, ternyata melebihi batas
    throw err;
  });
  if (!res) {
    return ctx.reply(`<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> File terlalu besar untuk dikirim bot (maks ${escH(formatBytes(MAX_BYTES))}).\nUnduh manual:\n${escH(url)}`, { parse_mode: "HTML" });
  }
  const source = Buffer.from(res.data);
  const filename = extra.filename || "file";
  // Di atas batas Bot API (49 MB) -> kirim lewat GramJS/MTProto (hanya chat pribadi), sebagai dokumen
  if (source.length > maxBotApiUploadBytes()) {
    if (mtprotoEnabled() && ctx.chat?.type === "private") {
      return sendFileMT(ctx.chat.id, source, filename, extra.caption || "");
    }
    return ctx.reply(`<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> File terlalu besar untuk dikirim di sini (${escH(formatBytes(source.length))}).\nUnduh manual:\n${escH(url)}`, { parse_mode: "HTML" });
  }
  const opts = { caption: extra.caption, parse_mode: extra.parse_mode };

  // detect: sesuaikan jenis kiriman dengan isi sebenarnya (Content-Type), lalu cadangkan ke dokumen bila Telegram menolak
  if (extra.detect) {
    const origType = type;
    const ct = String(res.headers["content-type"] || "").toLowerCase();
    if (ct.startsWith("image/") && !ct.includes("svg")) type = "photo";
    else if (ct.startsWith("video/")) type = "video";
    else if (ct.startsWith("audio/")) type = "audio";
    const ext = type === "photo" ? ct.includes("png") ? "png" : "jpg" : type === "audio" ? "mp3" : "mp4";
    const name = extra.filename && type === origType ? extra.filename : `${type}.${ext}`;
    try {
      if (type === "photo" && source.length > 10 * 1024 * 1024) throw new Error("too large for photo");
      if (type === "video") return await ctx.replyWithVideo({ source, filename: name }, { ...opts, supports_streaming: true });
      if (type === "audio") return await ctx.replyWithAudio({ source, filename: name }, { ...opts, title: extra.title });
      if (type === "photo") return await ctx.replyWithPhoto({ source }, opts);
    } catch {
      return ctx.replyWithDocument({ source, filename: name }, opts);
    }
  }

  switch (type) {
    case "video": return ctx.replyWithVideo({ source, filename }, opts);
    case "audio": return ctx.replyWithAudio({ source, filename }, { ...opts, title: extra.title });
    case "photo": return ctx.replyWithPhoto({ source }, opts);
    default: return ctx.replyWithDocument({ source, filename }, opts);
  }
}

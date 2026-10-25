import axios from "axios";
import config from "../../config.js";
import { isUrl, formatBytes, escH } from "../../src/lib/util.js";
import { sendFromUrl } from "../../src/lib/send.js";
import { parseMedia } from "../../src/lib/aiodl.js";

/**
 * /terabox <link>  — download dari TerraBox lewat API (config.js -> terabox).
 * Hasil dikirim sesuai jenis file: APK / file lain -> dokumen, audio -> musik, video -> video, foto -> foto.
 * Dipanggil: GET <apiUrl>?url=<link>&apikey=<apiKey>. Bisa juga lewat env TERABOX_API_KEY.
 */
const MAX_FILES = 5; // link folder bisa berisi banyak file; batasi supaya tidak spam

const TB_HOST = /(terabox|1024terabox|teraboxapp|teraboxshare|terafileshare|4funbox|mirrobox|nephobox|momerybox|freeterabox|tibibox|1024tera|terasharelink|terasharefile|teraboxlink)\./i;

const URL_KEYS = ["download_url", "downloadUrl", "direct_link", "directLink", "fast_download", "fastDownload", "dlink", "download", "dl", "url", "link", "src"];
const NAME_KEYS = ["filename", "file_name", "fileName", "server_filename", "name", "title"];
const SIZE_KEYS = ["size", "filesize", "file_size", "fileSize"];
const SKIP_KEY = /thumb|cover|preview|icon|poster|avatar|stream|m3u8/i;
const URL_KEY_LOOSE = /(download|dlink|dl_|_dl|^dl|direct|link|url|src|file)/i;
const NAME_KEY_LOOSE = /(file_?name|server_filename|^name$|^title$)/i;
// link halaman share TeraBox (bukan link unduhan langsung) dilewati
const isSharePage = (u) => TB_HOST.test(u) && /\/(s|wap\/share|sharing)\//i.test(u);

const EXT = {
  audio: /^(mp3|m4a|aac|opus|ogg|wav|flac|wma|amr)$/i,
  video: /^(mp4|mkv|webm|mov|avi|3gp|flv|m4v|ts)$/i,
  image: /^(jpe?g|png|webp|gif|bmp|heic)$/i,
  apk: /^(apk|apks|xapk|apkm)$/i,
};

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isHttp = (s) => typeof s === "string" && /^https?:\/\/\S+$/i.test(s.trim());

const tbCfg = () => {
  const c = config.terabox || {};
  return {
    apiUrl: String(c.apiUrl || "https://api.kyzzz.xyz/api/download/terabox").trim(),
    apiKey: String(process.env.TERABOX_API_KEY || c.apiKey || "").trim(),
    timeout: (Number(c.timeoutSec) || 90) * 1000,
  };
};

const extOf = (s = "") => {
  const m = String(s).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : "";
};

/** Tentukan jenis kiriman: apk | audio | video | image | file */
function kindOf(name, url, node) {
  const ext = extOf(name) || extOf(url);
  for (const k of ["apk", "audio", "video", "image"]) if (EXT[k].test(ext)) return k;
  const hint = `${node?.type ?? ""} ${node?.mime ?? ""} ${node?.mimeType ?? ""} ${node?.category ?? ""}`.toLowerCase();
  if (/android\.package|vnd\.android|apk/.test(hint)) return "apk";
  if (/audio/.test(hint)) return "audio";
  if (/video/.test(hint)) return "video";
  if (/image|photo/.test(hint)) return "image";
  return "file";
}

/** Baca respons API secara fleksibel (bentuk JSON bisa berbeda-beda) -> [{ url, name, size, kind }] */
function parseFiles(data, inputUrl) {
  const files = [];
  const seen = new Set();
  const push = (url, node) => {
    if (seen.has(url)) return;
    seen.add(url);
    let name = "";
    for (const k of NAME_KEYS) if (typeof node?.[k] === "string" && node[k].trim() && !isHttp(node[k])) { name = node[k].trim(); break; }
    if (!name) { const k = Object.keys(node || {}).find((x) => NAME_KEY_LOOSE.test(x) && typeof node[x] === "string" && node[x].trim() && !isHttp(node[x])); if (k) name = node[k].trim(); }
    let size = 0;
    for (const k of SIZE_KEYS) if (node?.[k] != null && !isNaN(Number(node[k]))) { size = Number(node[k]); break; }
    files.push({ url, name, size, kind: kindOf(name, url, node) });
  };
  const walk = (node, depth = 0) => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) return node.forEach((n) => (typeof n === "string" && isHttp(n) && n !== inputUrl && !isSharePage(n) ? push(n.trim(), {}) : walk(n, depth + 1)));
    if (typeof node !== "object") return;
    const okUrl = (k) => isHttp(node[k]) && node[k].trim() !== inputUrl && !isSharePage(node[k].trim()) && !SKIP_KEY.test(k);
    const key = URL_KEYS.find(okUrl) || Object.keys(node).find((k) => URL_KEY_LOOSE.test(k) && okUrl(k));
    if (key) return push(node[key].trim(), node);
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(data);

  // Cadangan: pakai parser umum bila bentuk JSON tidak dikenali
  if (!files.length) {
    for (const m of parseMedia(data, inputUrl).medias) push(m.url, { type: m.kind });
  }
  return files;
}

async function fetchTerabox(targetUrl) {
  const c = tbCfg();
  if (!c.apiKey) throw new Error("API key TeraBox belum diisi (config.js -> terabox.apiKey atau env TERABOX_API_KEY).");
  const res = await axios.get(c.apiUrl, {
    params: { url: targetUrl, apikey: c.apiKey },
    headers: { "User-Agent": "Mozilla/5.0", "x-api-key": c.apiKey },
    timeout: c.timeout,
    validateStatus: () => true,
  });
  let d = res.data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { /* bukan JSON */ } }
  const isObj = d && typeof d === "object";
  if (res.status >= 400 || (isObj && (d.status === false || d.success === false))) {
    const msg = (isObj && (d.message || d.error || d.msg)) || (typeof d === "string" ? d.slice(0, 150) : "") || `HTTP ${res.status}`;
    throw new Error(`${typeof msg === "string" ? msg : JSON.stringify(msg)}${res.status >= 400 ? ` (HTTP ${res.status})` : ""}`);
  }
  if (!isObj) throw new Error("API TeraBox mengembalikan respons tidak dikenal.");
  const files = parseFiles(d, targetUrl);
  if (!files.length) {
    const raw = JSON.stringify(d).split(c.apiKey).join("***");
    console.warn("[TERABOX] Respons tidak dikenali:", raw.slice(0, 2000));
    throw new Error(`File tidak ditemukan di respons.\nRespons API: ${raw.slice(0, 600)}${raw.length > 600 ? "…" : ""}`);
  }
  return files;
}

const safeName = (s = "") => s.replace(/[\\/:*?"<>|]+/g, "_").trim();

async function sendFile(ctx, f, i) {
  const ext = extOf(f.name) || extOf(f.url);
  const base = safeName(f.name) || `terabox-${i + 1}`;
  const sizeTxt = f.size ? `\n📦 ${formatBytes(f.size)}` : "";
  const opt = { parse_mode: "HTML" };

  if (f.kind === "apk") {
    const filename = /\.(apk|apks|xapk|apkm)$/i.test(base) ? base : `${base}.${ext && EXT.apk.test(ext) ? ext : "apk"}`;
    return sendFromUrl(ctx, f.url, "document", { ...opt, filename, caption: `<tg-emoji emoji-id="5934030269030864827">📱</tg-emoji> <b>${h(filename)}</b>${sizeTxt}` });
  }
  if (f.kind === "audio") {
    const filename = extOf(base) ? base : `${base}.${ext || "mp3"}`;
    return sendFromUrl(ctx, f.url, "audio", { ...opt, detect: true, filename, title: base.replace(/\.[a-z0-9]{2,5}$/i, ""), caption: `<tg-emoji emoji-id="5463107823946717464">🎵</tg-emoji> <b>${h(filename)}</b>${sizeTxt}` });
  }
  if (f.kind === "video") {
    const filename = extOf(base) ? base : `${base}.${ext || "mp4"}`;
    return sendFromUrl(ctx, f.url, "video", { ...opt, detect: true, filename, caption: `<tg-emoji emoji-id="5388724152930708079">🎬</tg-emoji> <b>${h(filename)}</b>${sizeTxt}` });
  }
  if (f.kind === "image") {
    const filename = extOf(base) ? base : `${base}.${ext || "jpg"}`;
    return sendFromUrl(ctx, f.url, "photo", { ...opt, detect: true, filename, caption: `<tg-emoji emoji-id="6120946172010959542">🖼️</tg-emoji> <b>${h(filename)}</b>${sizeTxt}` });
  }
  // file lain (zip, pdf, rar, dll.) -> dokumen
  const filename = extOf(base) ? base : ext ? `${base}.${ext}` : base;
  return sendFromUrl(ctx, f.url, "document", { ...opt, filename, caption: `<tg-emoji emoji-id="5431721976769027887">📁</tg-emoji> <b>${h(filename)}</b>${sizeTxt}` });
}

export default {
  command: ["terabox"],
  category: "download",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Download TeraBox (file, apk, audio, video, foto). Contoh: /terabox https://terabox.com/s/xxxx",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    const link = (text || "").trim().split(/\s+/)[0];
    if (!isUrl(link) || !TB_HOST.test(link)) {
      return ctx.reply("Contoh: /terabox https://terabox.com/s/xxxx\n\nHasil dikirim sebagai file, APK, audio, video, atau foto sesuai isi link.");
    }
    const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Sedang memproses link TeraBox...", { parse_mode: "HTML" });
    try {
      const files = await fetchTerabox(link);
      const list = files.slice(0, MAX_FILES);
      if (files.length > MAX_FILES) await ctx.reply(`<tg-emoji emoji-id="5431721976769027887">📂</tg-emoji> Ada ${escH(files.length)} file di link ini, hanya ${escH(MAX_FILES)} pertama yang dikirim.`, { parse_mode: "HTML" });

      let ok = 0;
      const errors = [];
      for (let i = 0; i < list.length; i++) {
        try {
          await sendFile(ctx, list[i], i);
          ok++;
        } catch (err) {
          errors.push(`• ${list[i].name || `file ${i + 1}`}: ${err.message}`);
        }
      }
      if (!ok) throw new Error(errors.join("\n") || "Tidak ada file yang bisa dikirim.");
      if (errors.length) await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sebagian file gagal:\n${escH(errors.join("\n"))}`, { parse_mode: "HTML" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

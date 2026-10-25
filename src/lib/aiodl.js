import axios from "axios";
import config from "../../config.js";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

// ── Parser respons (bentuk JSON bisa berubah, jadi dibaca fleksibel) ──
const URL_KEYS = /^(url|downloadurl|download_url|download|dl|link|href|src|playurl|play|hdplay|wmplay|nowm|videos?|audios?|music|images?|photos?|pictures?|mp4|mp3|file|links?)$/i;
const SKIP_KEYS = /thumb|cover|avatar|poster|preview|icon|logo|origin|profile|banner/i;
const TITLE_KEYS = ["title", "caption", "desc", "description", "text", "name"];
const isHttp = (s) => typeof s === "string" && /^https?:\/\/\S+$/i.test(s.trim());
const AUDIO_EXT = /\.(mp3|m4a|aac|opus|ogg|wav)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

function kindOf(url, node, key) {
  const hint = `${key} ${node?.type ?? ""} ${node?.mime ?? ""} ${node?.mimeType ?? ""} ${node?.format ?? ""} ${node?.ext ?? ""} ${node?.extension ?? ""}`.toLowerCase();
  if (/audio|music|mp3|m4a|aac|opus/.test(hint) || AUDIO_EXT.test(url)) return "audio";
  if (/image|photo|jpe?g|png|webp/.test(hint) || IMAGE_EXT.test(url)) return "image";
  if (/video|mp4|webm/.test(hint) || VIDEO_EXT.test(url)) return "video";
  return "video";
}
const qualityOf = (node) => {
  const m = `${node?.quality ?? ""} ${node?.label ?? ""} ${node?.resolution ?? ""} ${node?.height ?? ""}`.match(/(\d{3,4})\s*p?/);
  return m ? Number(m[1]) : 0;
};
const isWatermark = (key, node) => {
  const s = `${key} ${node?.label ?? ""} ${node?.quality ?? ""}`;
  return /(^|[^a-z])(wm|watermark)/i.test(s) && !/no.?wm|no.?watermark|without|tanpa/i.test(s);
};

/** Return { title, medias: [{ url, kind, quality, wm }] } */
export function parseMedia(data, inputUrl = "") {
  const medias = [];
  const seen = new Set();
  let title = "";
  const add = (url, node, key) => {
    if (!isHttp(url) || !URL_KEYS.test(key) || SKIP_KEYS.test(key) || url === inputUrl || seen.has(url)) return;
    seen.add(url);
    medias.push({ url, kind: kindOf(url, node, key), quality: qualityOf(node), wm: isWatermark(key, node) });
  };
  const walk = (node, key = "", depth = 0) => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") return add(node, null, key);
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key, depth + 1));
    if (typeof node !== "object") return;
    if (!title) for (const k of TITLE_KEYS) if (typeof node[k] === "string" && node[k].trim() && !isHttp(node[k])) { title = node[k].trim(); break; }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string") add(v, node, k);
      else walk(v, k, depth + 1);
    }
  };
  walk(data);
  return { title, medias };
}

// ── API downloader: api.theresav.eu (config.js -> aio) ──
const aioCfg = () => {
  const c = config.aio || {};
  return {
    apiUrl: String(c.apiUrl || "https://api.theresav.eu/api/download/aio").trim(),
    apiKey: String(process.env.AIO_API_KEY || c.apiKey || "").trim(),
    timeout: (Number(c.timeoutSec) || 90) * 1000,
  };
};

// Cadangan bila bentuk JSON tidak dikenali parseMedia: ambil semua URL http selain thumbnail/cover
function parseLoose(data, inputUrl) {
  const medias = [];
  const seen = new Set();
  let title = "";
  const walk = (node, key = "", depth = 0) => {
    if (depth > 8 || node == null) return;
    if (typeof node === "string") {
      if (isHttp(node) && !SKIP_KEYS.test(key) && node !== inputUrl && !seen.has(node)) {
        seen.add(node);
        medias.push({ url: node, kind: kindOf(node, null, key), quality: qualityOf({ quality: key }), wm: isWatermark(key, null) });
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key, depth + 1));
    if (typeof node !== "object") return;
    if (!title) for (const k of TITLE_KEYS) if (typeof node[k] === "string" && node[k].trim() && !isHttp(node[k])) { title = node[k].trim(); break; }
    for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1);
  };
  walk(data);
  return { title, medias };
}

async function fetchDownloadApi(targetUrl) {
  const c = aioCfg();
  const res = await axios.get(c.apiUrl, {
    params: { url: targetUrl, apikey: c.apiKey },
    headers: { "User-Agent": UA, "x-api-key": c.apiKey },
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
  if (!isObj) throw new Error("API downloader mengembalikan respons tidak dikenal.");
  let parsed = parseMedia(d, targetUrl);
  if (!parsed.medias.length) parsed = parseLoose(d, targetUrl);
  if (!parsed.medias.length) throw new Error("Link unduhan tidak ditemukan di respons (URL tidak didukung).");
  return parsed;
}

/** Ambil link unduhan lewat API (config.js -> aio). Tidak memakai solver captcha. */
export async function fetchDownload(targetUrl) {
  if (!aioCfg().apiKey) throw new Error("API key downloader belum diisi (config.js -> aio.apiKey atau env AIO_API_KEY).");
  return fetchDownloadApi(targetUrl);
}

/** Pilih media terbaik: tanpa watermark, kualitas tertinggi tapi <= 720p (supaya muat dikirim bot) */
export function pickBest(medias, kind) {
  const list = medias.filter((m) => m.kind === kind);
  if (!list.length) return null;
  const clean = list.filter((m) => !m.wm);
  const sorted = [...(clean.length ? clean : list)].sort((a, b) => b.quality - a.quality);
  return sorted.find((m) => !m.quality || m.quality <= 720) || sorted[sorted.length - 1];
}

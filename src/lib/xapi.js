import axios from "axios";
import config from "../../config.js";

export const XRINA = "https://apiii-xrina.my.id";
export const NEXRAY = "https://api.nexray.eu.cc";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Opsional: kalau provider butuh apikey, isi config.apis.xrina.apiKey / config.apis.nexray.apiKey (atau env)
const keyFor = (base) => {
  const k = base === XRINA ? (process.env.XRINA_API_KEY || config.apis?.xrina?.apiKey) : (process.env.NEXRAY_API_KEY || config.apis?.nexray?.apiKey);
  return (k || "").trim();
};

/** Cari URL (http/https) di JSON respons, apa pun bentuknya */
export function findUrl(v, depth = 0) {
  if (depth > 5 || v == null) return null;
  if (typeof v === "string") return /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) { for (const x of v) { const u = findUrl(x, depth + 1); if (u) return u; } return null; }
  if (typeof v === "object") {
    for (const k of ["result", "url", "image", "audio", "output", "data", "download"]) {
      const u = findUrl(v[k], depth + 1);
      if (u) return u;
    }
    for (const x of Object.values(v)) { const u = findUrl(x, depth + 1); if (u) return u; }
  }
  return null;
}

/** Cari teks jawaban di JSON respons */
export function findText(v, depth = 0) {
  if (depth > 5 || v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) { for (const x of v) { const t = findText(x, depth + 1); if (t) return t; } return null; }
  if (typeof v === "object") {
    for (const k of ["result", "answer", "response", "reply", "text", "message", "output", "prompt", "content", "data"]) {
      const t = findText(v[k], depth + 1);
      if (t) return t;
    }
  }
  return null;
}

/**
 * GET ke API. Mengembalikan { buf, type, json }:
 *  - API langsung mengirim file (image/audio/video) -> buf terisi
 *  - API mengirim JSON -> json terisi
 */
export async function callApi(base, path, params = {}, { timeout = 120000 } = {}) {
  const key = keyFor(base);
  const res = await axios.get(base + path, {
    params: { ...params, ...(key ? { apikey: key } : {}) },
    responseType: "arraybuffer",
    timeout,
    maxContentLength: 60 * 1024 * 1024,
    headers: { "User-Agent": UA, ...(key ? { "x-apikey": key } : {}) },
    validateStatus: () => true,
  });
  const type = String(res.headers["content-type"] || "");
  const buf = Buffer.from(res.data);
  if (res.status < 400 && /^(image|audio|video)\//.test(type)) return { buf, type, json: null, status: res.status };

  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* bukan JSON */ }
  if (res.status >= 400 || json?.status === false || json?.success === false) {
    const msg = (typeof json?.message === "string" && json.message) || (typeof json?.error === "string" && json.error) || json?.msg || buf.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "";
    const err = new Error(`${msg || "Permintaan gagal"} (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { buf: null, type, json, status: res.status, text: json ? null : buf.toString("utf8").trim() };
}

/**
 * Panggil API dengan beberapa kemungkinan nama parameter (mis. text/q/prompt).
 * Dicoba berurutan hanya jika server menolak dengan 400/422.
 */
export async function callApiTry(base, path, paramSets, opts) {
  let lastErr;
  for (const params of paramSets) {
    try { return await callApi(base, path, params, opts); }
    catch (err) {
      lastErr = err;
      if (![400, 422].includes(err.status)) throw err;
    }
  }
  throw lastErr;
}

export async function downloadBuffer(url, timeout = 90000) {
  const { data, headers } = await axios.get(url, { responseType: "arraybuffer", timeout, headers: { "User-Agent": UA }, maxContentLength: 60 * 1024 * 1024 });
  return { buf: Buffer.from(data), type: String(headers["content-type"] || "") };
}

/** Ambil file hasil dari respons callApi (langsung buffer atau lewat URL di JSON) */
function findBase64(v, depth = 0) {
  if (depth > 5 || v == null) return null;
  if (typeof v === "string") {
    const m = v.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
    if (m) return Buffer.from(m[1], "base64");
    return null;
  }
  if (Array.isArray(v)) { for (const x of v) { const b = findBase64(x, depth + 1); if (b) return b; } return null; }
  if (typeof v === "object") { for (const x of Object.values(v)) { const b = findBase64(x, depth + 1); if (b) return b; } }
  return null;
}

export async function resolveFile(r) {
  if (r.buf) return { buf: r.buf, type: r.type };
  const b64 = findBase64(r.json);
  if (b64) return { buf: b64, type: "image/png" };
  const url = findUrl(r.json);
  if (!url) throw new Error(`API tidak mengembalikan file hasil: ${JSON.stringify(r.json ?? r.text ?? "").slice(0, 200)}`);
  return downloadBuffer(url);
}

/** API butuh link gambar, jadi foto Telegram diunggah dulu ke host sementara (Catbox -> Uguu) */
export async function uploadTemp(buf, name = "image.jpg") {
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    if (process.env.CATBOX_USERHASH) form.append("userhash", process.env.CATBOX_USERHASH);
    form.append("fileToUpload", new Blob([buf]), name);
    const { data } = await axios.post("https://catbox.moe/user/api.php", form, { timeout: 60000, maxBodyLength: Infinity, headers: { "User-Agent": "curl/8.5.0" } });
    const url = typeof data === "string" ? data.trim() : "";
    if (/^https?:\/\//.test(url)) return url;
  } catch { /* lanjut ke Uguu */ }
  const form = new FormData();
  form.append("files[]", new Blob([buf]), name);
  const { data } = await axios.post("https://uguu.se/upload?output=json", form, { timeout: 60000, maxBodyLength: Infinity, headers: { "User-Agent": UA } });
  const url = data?.files?.[0]?.url;
  if (!url) throw new Error("Gagal mengunggah gambar sementara");
  return url;
}

/** Kirim teks panjang per 4000 karakter (batas Telegram 4096) */
export async function replyLong(ctx, text) {
  const t = String(text || "(tidak ada jawaban)");
  for (let i = 0; i < t.length; i += 4000) await ctx.reply(t.slice(i, i + 4000));
}

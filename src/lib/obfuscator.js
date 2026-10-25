// src/lib/obfuscator.js
// Klien untuk API obfuscator JS (config.js -> obfuscator). Dipakai oleh plugins/tools/enc.js.

import axios from "axios";
import config from "../../config.js";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const DEFAULTS = {
  apiUrl: "https://api.kyzzz.xyz/api/tools/js-obfuscator",
  apiKey: "",
  timeoutSec: 60,
};

export const LEVELS = ["low", "medium", "high"];

const cfg = () => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(config.obfuscator || {}).filter(([, v]) => v !== "" && v != null)) });

/** /enc aktif selama obfuscator.apiUrl & obfuscator.apiKey tidak dikosongkan */
export const obfuscatorReady = () => {
  const c = cfg();
  return !!(c.apiUrl && c.apiKey);
};

const snippet = (v, n = 220) => {
  try {
    const t = typeof v === "string" ? v : JSON.stringify(v);
    return t.length > n ? t.slice(0, n) + "…" : t;
  } catch {
    return String(v);
  }
};

// Bentuk respons API bisa beda-beda (teks langsung, { result }, { data }, { url }, dll) -> dibaca fleksibel
function extractResult(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf-8");
  if (data && typeof data === "object") {
    for (const k of ["result", "data", "code", "output", "obfuscated", "content"]) {
      if (typeof data[k] === "string" && data[k].trim()) return data[k];
    }
    if (typeof data.url === "string" && data.url.trim()) return { url: data.url };
  }
  return null;
}

/**
 * Obfuscate kode JS lewat API eksternal.
 * @param {string} code  kode JS asli
 * @param {"low"|"medium"|"high"} level  tingkat obfuscate
 * @returns {Promise<string>} kode hasil obfuscate
 */
export async function obfuscateCode(code, level = "medium") {
  const c = cfg();
  if (!c.apiUrl) throw new Error("Fitur belum aktif. Owner perlu mengisi obfuscator.apiUrl di config.js.");
  if (!c.apiKey) throw new Error("Fitur belum aktif. Owner perlu mengisi obfuscator.apiKey di config.js.");
  if (!LEVELS.includes(level)) throw new Error(`Level tidak dikenal: ${level} (pilih: ${LEVELS.join("/")}).`);

  let res;
  try {
    res = await axios.post(
      c.apiUrl,
      { code, apikey: c.apiKey, level },
      {
        headers: { "User-Agent": UA, "x-api-key": c.apiKey, "Content-Type": "application/json" },
        timeout: (Number(c.timeoutSec) || 60) * 1000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    throw new Error(`Gagal menghubungi API obfuscator: ${err.message}`);
  }

  let d = res.data;
  if (typeof d === "string") {
    const t = d.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { d = JSON.parse(t); } catch { /* bukan JSON, biarkan string */ }
    }
  }
  const isObj = d && typeof d === "object";
  if (res.status >= 400 || (isObj && (d.status === false || d.success === false))) {
    const msg = (isObj && (d.message || d.error || d.msg)) || (typeof d === "string" ? d.slice(0, 150) : "") || `HTTP ${res.status}`;
    throw new Error(`${typeof msg === "string" ? msg : JSON.stringify(msg)}${res.status >= 400 ? ` (HTTP ${res.status})` : ""}`);
  }

  const result = extractResult(d);
  if (!result) {
    console.error("[OBFUSCATOR] respons tidak dikenal:", snippet(d, 500));
    throw new Error("API obfuscator mengembalikan respons yang tidak dikenal.");
  }
  if (typeof result === "object" && result.url) {
    const dl = await axios.get(result.url, { responseType: "text", timeout: (Number(c.timeoutSec) || 60) * 1000, validateStatus: () => true });
    if (dl.status >= 400 || !dl.data) throw new Error(`Gagal mengunduh hasil obfuscate (HTTP ${dl.status}).`);
    return String(dl.data);
  }
  return String(result);
}

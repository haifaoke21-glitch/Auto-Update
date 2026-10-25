// Helper bypass link (api.kyzzz.xyz). Dipakai semua plugin di plugins/bypass/.
// Setting di config.js -> bypass (apiKey juga bisa lewat env BYPASS_API_KEY).
import axios from "axios";
import config from "../../config.js";
import { escH } from "./util.js";

// Provider: "kyzzz" (default, config.bypass) dan "theresav" (config.bypass.theresav)
const PROVIDERS = {
  kyzzz: { base: "https://api.kyzzz.xyz/api/bypass", env: "BYPASS_API_KEY" },
  theresav: { base: "https://api.theresav.eu/api/bypass", env: "BYPASS_THERESAV_API_KEY" },
};
const cfg = (provider = "kyzzz") => {
  const root = config.bypass || {};
  const p = PROVIDERS[provider] || PROVIDERS.kyzzz;
  const c = provider === "kyzzz" ? root : root[provider] || {};
  return {
    baseUrl: (c.baseUrl || p.base).replace(/\/+$/, ""),
    apiKey: (process.env[p.env] || c.apiKey || "").trim(),
    timeoutSec: c.timeoutSec || root.timeoutSec || 60,
    keyName: provider === "kyzzz" ? "bypass.apiKey" : `bypass.${provider}.apiKey`,
  };
};

// Cara kirim API key. Varian pertama = standar; sisanya dicoba otomatis bila server membalas 401/403.
// Varian yang berhasil diingat supaya request berikutnya langsung memakainya.
const AUTH_VARIANTS = (key) => [
  { params: { apikey: key }, headers: { "x-api-key": key, Authorization: `Bearer ${key}` } },
  { params: { key } },
  { params: { api_key: key } },
  { params: { apiKey: key } },
];
const goodVariant = {}; // per provider

/** Ambil link hasil dari berbagai bentuk JSON respons */
function extractText(data, depth = 0) {
  if (typeof data === "string") return data.trim() && !/^(true|false|success|ok)$/i.test(data.trim()) ? data.trim() : null;
  if (!data || typeof data !== "object" || depth > 3) return null;
  for (const k of ["key", "result", "bypassed", "bypass", "password", "code", "data", "message"]) {
    if (data[k] == null) continue;
    const t = extractText(data[k], depth + 1);
    if (t) return t;
  }
  return null;
}

function extractResult(data, input, acceptText = false) {
  if (acceptText) {
    const url = extractResult(data, input, false);
    return url || extractText(data);
  }
  if (typeof data === "string") return /^https?:\/\//i.test(data.trim()) ? data.trim() : null;
  if (!data || typeof data !== "object") return null;
  const KEYS = ["result", "bypassed", "bypass", "destination", "destination_url", "final", "link", "url", "data", "target", "original"];
  for (const k of KEYS) {
    if (data[k] == null) continue;
    const v = data[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim()) && v.trim() !== input) return v.trim();
    if (typeof v === "object") {
      const deep = extractResult(v, input);
      if (deep) return deep;
    }
  }
  // cadangan: link http pertama di mana pun di dalam JSON yang bukan link asal
  const found = JSON.stringify(data).match(/https?:\/\/[^"\s\\]+/g) || [];
  return found.find((u) => u !== input) || null;
}

const errMsg = (data) => {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 200);
  return String(data.message || data.msg || data.error || data.detail || "").slice(0, 200);
};

/** Panggil endpoint bypass. Return { result, raw }. Melempar Error berpesan jelas bila gagal. */
export async function bypassRequest(endpoint, link, provider = "kyzzz", opts = {}) {
  const { baseUrl, apiKey, timeoutSec, keyName } = cfg(provider);
  if (!apiKey) throw new Error(`API key bypass belum diisi. Owner perlu mengisi ${keyName} di config.js.`);

  const variants = AUTH_VARIANTS(apiKey);
  const first = goodVariant[provider] ?? 0;
  const order = [first, ...variants.map((_, i) => i).filter((i) => i !== first)];
  let lastErr;

  for (const i of order) {
    const v = variants[i];
    try {
      const { data } = await axios.get(`${baseUrl}/${endpoint}`, {
        params: { url: link, ...v.params },
        headers: v.headers,
        timeout: timeoutSec * 1000,
      });
      goodVariant[provider] = i;
      if (data && typeof data === "object" && (data.status === false || data.success === false || data.ok === false)) {
        throw new Error(errMsg(data) || "Gagal mem-bypass link.");
      }
      const result = extractResult(data, link, opts.acceptText);
      if (!result) {
        const rawTxt = typeof data === "string" ? data : JSON.stringify(data || {});
        console.log(`[bypass] ${provider}/${endpoint} respons tak dikenali:`, rawTxt.slice(0, 500));
        throw new Error(errMsg(data) || `Hasil bypass tidak ditemukan. Respons API: ${rawTxt.slice(0, 150)}`);
      }
      return { result, raw: data };
    } catch (e) {
      const status = e.response?.status;
      lastErr = e;
      if (status === 401 || status === 403) continue; // coba cara kirim key yang lain
      if (e.response) {
        const d = e.response.data;
        const detail = errMsg(d) || (d && typeof d === "object" ? JSON.stringify(d).slice(0, 200) : "");
        throw new Error(detail ? `${detail} (HTTP ${status})` : `Server API membalas HTTP ${status}.`);
      }
      if (e.code === "ECONNABORTED") throw new Error("Server API terlalu lama merespons, coba lagi.");
      throw e;
    }
  }
  const status = lastErr?.response?.status;
  throw new Error(`API key ditolak server (${status || "401"}). Cek ${keyName} di config.js.`);
}

/** Ambil link dari argumen perintah, atau dari pesan yang di-reply */
export function pickLink(ctx, text) {
  const re = /https?:\/\/[^\s<>"']+/i;
  const src = [text, ctx.message?.reply_to_message?.text, ctx.message?.reply_to_message?.caption];
  for (const s of src) {
    const m = (s || "").match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Rute untuk keluarga link "unlock". Dicoba berurutan sampai ada yang berhasil.
 *  - sub4unlock.io        -> theresav /sub4unlock (utama)
 *  - sub2unlock.*         -> theresav /sub2unlock
 *  - subs4unlock.com/.id  -> theresav /sub4unlock lalu kyzzz /subs4unlock
 */
export function unlockRoutes(link) {
  let host = "";
  try { host = new URL(link).hostname.toLowerCase(); } catch {}
  const t4 = { endpoint: "sub4unlock", provider: "theresav" };
  const t2 = { endpoint: "sub2unlock", provider: "theresav" };
  const k4 = { endpoint: "subs4unlock", provider: "kyzzz" };
  if (/(^|\.)subs?2unlock\./.test(host)) return [t2, t4, k4];
  return [t4, k4, t2];
}

// Endpoint theresav yang namanya sama dengan kata kunci di domain linknya (dari api.theresav.eu/docs).
const THERESAV_HOSTS = [
  "adlinksumo", "adsafe", "bicolink", "biplab", "cutwin", "delta", "droplink", "earnlinks", "izen",
  "linkpays", "linkpoi", "linkvertise", "moneyblink", "move2link", "pndk", "shrinkme", "vplink",
];

/**
 * Rute untuk /bypass (umum) memakai DUA API: kyzzz & theresav.
 * Domain dikenali -> endpoint khususnya dicoba dulu, lalu endpoint umum
 * kyzzz /bypass, lalu theresav /universal sebagai cadangan terakhir.
 */
export function generalRoutes(link) {
  let host = "";
  try { host = new URL(link).hostname.toLowerCase(); } catch {}
  const K = (endpoint) => ({ endpoint, provider: "kyzzz" });
  const T = (endpoint) => ({ endpoint, provider: "theresav" });
  const specific = [];
  if (/unlock\./.test(host)) specific.push(...unlockRoutes(link));
  else if (/(^|\.)ouo\./.test(host)) specific.push(K("ouo"), T("ouo"));
  else if (/(^|\.)sfl\./.test(host)) specific.push(K("sfl"), T("sfl"));
  else if (/safelinku/.test(host)) specific.push(K("safelinku"));
  else {
    const hit = THERESAV_HOSTS.find((k) => host.includes(k));
    if (hit) specific.push(T(hit));
  }
  const all = [...specific, K("bypass"), T("universal")];
  const seen = new Set();
  return all.filter((r) => !seen.has(r.provider + r.endpoint) && seen.add(r.provider + r.endpoint));
}

/** Rute 2 API untuk endpoint bernama sama di kyzzz & theresav (kyzzz dulu, theresav sebagai cadangan) */
export const dualRoutes = (endpoint) => () => [
  { endpoint, provider: "kyzzz" },
  { endpoint, provider: "theresav" },
];

/** Bangun plugin bypass supaya setiap command cukup 1 file kecil */
export function makeBypassPlugin({ command, endpoint, label, example, hosts, provider = "kyzzz", routes, acceptText = false }) {
  return {
    command,
    category: "bypass",
    description: `Bypass link ${label}. Contoh: /${command[0]} ${example}`,
    cooldown: 5000,
    run: async (ctx, { text }) => {
      const link = pickLink(ctx, text);
      if (!link) return ctx.reply(`Contoh: /${command[0]} ${example}\nAtau reply pesan yang berisi link.`);
      if (hosts && !hosts.test(link)) {
        return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Link bukan dari ${escH(label)}.\nContoh: /${command[0]} ${escH(example)}`, { parse_mode: "HTML" });
      }
      try {
        const list = routes ? routes(link) : [{ endpoint, provider }];
        let result, errs = [];
        for (const r of list) {
          try {
            ({ result } = await bypassRequest(r.endpoint, link, r.provider, { acceptText }));
            break;
          } catch (e) {
            errs.push(e.message);
          }
        }
        if (!result) throw new Error([...new Set(errs)].slice(0, 2).join(" | "));
        await ctx.reply(
          `<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Bypass ${escH(label)} berhasil</b>\n\n` +
            `<b>Link asal:</b>\n<code>${escH(link)}</code>\n\n<b>Hasil:</b>\n${/^https?:\/\//i.test(result) ? escH(result) : `<code>${escH(result)}</code>`}`,
          { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
        );
      } catch (err) {
        await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
      }
    },
  };
}

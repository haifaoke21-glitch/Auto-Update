// Lapisan jaringan Telegram: paksa IPv4, proxy opsional, API mirror opsional, retry otomatis.
// Semua opsi bisa diisi lewat config.js -> network ATAU environment variable (Startup panel).
import dns from "node:dns";
import https from "node:https";
import chalk from "chalk";
import config from "../../config.js";

// 1) IPv4 dulu: banyak panel punya IPv6 rusak -> ETIMEDOUT
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const net = () => config.network || {};
const pick = (envName, key) => (process.env[envName] || net()[key] || "").trim();

export const telegramProxy = () => pick("TELEGRAM_PROXY", "proxy");
export const telegramApiRoot = () => pick("TELEGRAM_API_ROOT", "apiRoot");

// ── Batas ukuran file ──
// Bot API resmi (api.telegram.org): upload maks 50 MB, unduh maks 20 MB.
// Dua jalan keluar: (a) Local Bot API Server (apiRoot custom), atau (b) GramJS/MTProto (config.mtproto, src/lib/mtproto.js).
const MB = 1024 * 1024;
const isLocalApiRoot = () => { const r = telegramApiRoot(); return Boolean(r) && !/api\.telegram\.org/i.test(r); };
const sendCapMB = () => (Number(net().maxSendMB) > 0 ? Number(net().maxSendMB) : 500);

/** true bila API ID + API Hash tersedia (config.mtproto atau env API_ID / API_HASH) dan tidak dimatikan */
export function mtprotoConfigured() {
  const c = config.mtproto || {};
  if (c.enabled === false) return false;
  return Boolean(Number(process.env.API_ID || c.apiId) && String(process.env.API_HASH || c.apiHash || "").trim());
}

/** Batas upload lewat Bot API biasa (Telegraf): 49 MB di server resmi, sampai maxSendMB bila pakai Local Bot API Server */
export const maxBotApiUploadBytes = () => (isLocalApiRoot() ? sendCapMB() : 49) * MB;
/** Batas unduh lewat Bot API biasa (Telegraf): 20 MB di server resmi, ~2 GB bila Local Bot API Server */
export const maxBotApiDownloadBytes = () => (isLocalApiRoot() ? 2000 : 20) * MB;
/** Batas upload efektif bot (maxSendMB, default 500 MB) bila GramJS aktif atau Local Bot API Server; kalau tidak, 49 MB */
export const maxUploadBytes = () => (mtprotoConfigured() || isLocalApiRoot() ? sendCapMB() : 49) * MB;
/** Batas unduh efektif bot: ~2 GB bila GramJS aktif atau Local Bot API Server; kalau tidak, 20 MB */
export const maxDownloadBytes = () => (mtprotoConfigured() || isLocalApiRoot() ? 2000 : 20) * MB;
export const isTooLargeErr = (err) => /maxContentLength|maxBodyLength/i.test(err?.message || "");

async function buildAgent() {
  const proxy = telegramProxy();
  try {
    if (proxy) {
      if (/^socks/i.test(proxy)) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        return new SocksProxyAgent(proxy);
      }
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      return new HttpsProxyAgent(proxy);
    }
  } catch (e) {
    console.warn(chalk.yellow(`[NET] Proxy tidak bisa dipakai (${e.message}). Jalankan: npm i https-proxy-agent socks-proxy-agent`));
  }
  return new https.Agent({ keepAlive: true, family: 4 });
}

// Opsi untuk `new Telegraf(token, opts)`
export async function telegrafOptions() {
  const telegram = { agent: await buildAgent() };
  const root = telegramApiRoot();
  if (root) telegram.apiRoot = root.replace(/\/+$/, "");
  // handler dijalankan di latar belakang (lihat botSetup.js), jadi timeout hanya jaring pengaman
  return { telegram, handlerTimeout: 10 * 60_000 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry dengan backoff; tidak menyerah selama koneksi masih bermasalah (default tanpa batas)
export async function withRetry(fn, { label = "request", tries = Infinity, baseMs = 3000, maxMs = 30000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = e.code || e.errno || e.type;
      const netErr = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "system"].includes(code);
      if (!netErr || i >= tries) throw e;
      const wait = Math.min(baseMs * 2 ** Math.min(i - 1, 4), maxMs);
      console.warn(chalk.yellow(`[NET] ${label} gagal (${code}). Coba lagi ${i} dalam ${wait / 1000}s...`));
      if (i === 3) console.warn(chalk.yellow("[NET] Server mungkin memblokir api.telegram.org. Isi TELEGRAM_PROXY atau TELEGRAM_API_ROOT di Startup."));
      await sleep(wait);
    }
  }
}

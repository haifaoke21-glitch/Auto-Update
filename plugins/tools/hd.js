import axios from "axios";
import config from "../../config.js";
import { getMediaBuffer, formatBytes, escH } from "../../src/lib/util.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const cfg = () => {
  const c = config.hd || {};
  return {
    apiUrl: (c.apiUrl || "https://api.theresav.eu/api/tools/hd").trim(),
    apiKey: (process.env.HD_API_KEY || c.apiKey || "").trim(),
    scale: Number(c.scale) || 2,
    timeout: (Number(c.timeoutSec) || 120) * 1000,
  };
};

// API butuh link gambar, jadi foto Telegram diunggah dulu ke host sementara (Catbox -> Uguu sebagai cadangan)
async function uploadTemp(buf) {
  const name = "hd.jpg";
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    if (process.env.CATBOX_USERHASH) form.append("userhash", process.env.CATBOX_USERHASH);
    form.append("fileToUpload", new Blob([buf]), name);
    const { data } = await axios.post("https://catbox.moe/user/api.php", form, {
      timeout: 60000, maxBodyLength: Infinity, headers: { "User-Agent": "curl/8.5.0" },
    });
    const url = typeof data === "string" ? data.trim() : "";
    if (/^https?:\/\//.test(url)) return url;
  } catch { /* lanjut ke Uguu */ }
  const form = new FormData();
  form.append("files[]", new Blob([buf]), name);
  const { data } = await axios.post("https://uguu.se/upload?output=json", form, {
    timeout: 60000, maxBodyLength: Infinity, headers: { "User-Agent": UA },
  });
  const url = data?.files?.[0]?.url;
  if (!url) throw new Error("Gagal mengunggah gambar sementara");
  return url;
}

// Cari URL hasil di JSON respons (result / data / url / image / ...), apa pun bentuknya
function findUrl(v, depth = 0) {
  if (depth > 4 || v == null) return null;
  if (typeof v === "string") return /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) { for (const x of v) { const u = findUrl(x, depth + 1); if (u) return u; } return null; }
  if (typeof v === "object") {
    for (const k of ["result", "url", "image", "output", "data", "hd", "download"]) {
      const u = findUrl(v[k], depth + 1);
      if (u) return u;
    }
    for (const x of Object.values(v)) { const u = findUrl(x, depth + 1); if (u) return u; }
  }
  return null;
}

async function enhance(imageUrl, scale) {
  const c = cfg();
  const res = await axios.get(c.apiUrl, {
    params: { url: imageUrl, scale, apikey: c.apiKey },
    responseType: "arraybuffer",
    timeout: c.timeout,
    maxContentLength: 60 * 1024 * 1024,
    headers: { "User-Agent": UA, "x-api-key": c.apiKey },
    validateStatus: () => true,
  });
  const type = String(res.headers["content-type"] || "");
  const buf = Buffer.from(res.data);

  if (type.startsWith("image/") && res.status < 400) return buf; // API langsung mengirim gambar

  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* bukan JSON */ }
  if (res.status >= 400 || json?.status === false || json?.success === false) {
    const msg = json?.message || json?.error || json?.msg || buf.toString("utf8").slice(0, 150) || `HTTP ${res.status}`;
    throw new Error(`${msg}${res.status >= 400 ? ` (HTTP ${res.status})` : ""}`);
  }
  const out = findUrl(json);
  if (!out) throw new Error("API tidak mengembalikan gambar hasil");
  const dl = await axios.get(out, { responseType: "arraybuffer", timeout: 60000, headers: { "User-Agent": UA } });
  return Buffer.from(dl.data);
}

export default {
  command: ["hd", "upscale", "remini"],
  category: "tools",
  loading: false, // pesan tunggu sendiri
  loadingAction: "upload_photo",
  description: "Perjelas & perbesar foto jadi HD. Balas foto dengan /hd (atau /hd 4)",
  cooldown: 10000,
  run: async (ctx, { args }) => {
    const c = cfg();
    if (!c.apiKey) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Fitur HD belum aktif. Owner perlu mengisi hd.apiKey di config.js.", { parse_mode: "HTML" });

    const buf = await getMediaBuffer(ctx, ["photo", "document"]);
    if (!buf) return ctx.reply("Contoh: balas/kirim sebuah foto dengan /hd\nOpsional skala: /hd 4 (2–4, default " + c.scale + ")");

    const asked = parseInt(args?.[0], 10);
    const scale = Number.isFinite(asked) ? Math.min(Math.max(asked, 2), 4) : c.scale;

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Sedang memperjelas gambar, tunggu sebentar...", { parse_mode: "HTML" });
    const typing = setInterval(() => ctx.sendChatAction("upload_photo").catch(() => {}), 4500);
    try {
      const link = await uploadTemp(buf);
      const out = await enhance(link, scale);
      const caption = `✅ HD ${scale}x selesai (${formatBytes(out.length)})`;
      // Dikirim sebagai gambar; kalau ditolak Telegram (mis. >10MB / dimensi terlalu besar) kirim sebagai file
      try {
        if (out.length > 10 * 1024 * 1024) throw new Error("too large for photo");
        await ctx.replyWithPhoto({ source: out }, { caption });
      } catch {
        await ctx.replyWithDocument({ source: out, filename: `hd_${scale}x.png` }, { caption: `${caption}\n(dikirim sebagai file karena terlalu besar untuk foto)` });
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal memproses HD: ${escH(err.response?.data?.message || err.message)}`, { parse_mode: "HTML" });
    } finally {
      clearInterval(typing);
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

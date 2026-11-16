import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import FormData from "form-data";
import { formatBytes, escH } from "../../src/lib/util.js";
import { registerCallback } from "../../src/lib/callbacks.js";

const API = "https://apiii-xrina.my.id/tools/hdvid";
const MODES = {
  hd2x: "HD 2×",
  hd4x: "HD 4×",
  cinematic: "Cinematic",
};

const pendingVideos = new Map();
const MAX_SIZE = 80 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function getKey(ctx) {
  return `${ctx.chat.id}:${ctx.from.id}`;
}

function cleanOld() {
  const now = Date.now();
  for (const [key, data] of pendingVideos) {
    if (now - data.timestamp > 10 * 60 * 1000) pendingVideos.delete(key);
  }
}

function tempPath(ext = "mp4") {
  return path.join(os.tmpdir(), `hdvid-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

async function downloadToFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const dest = tempPath("mp4");

  const res = await axios.get(link.href, {
    responseType: "arraybuffer",
    timeout: 90000,
    maxContentLength: MAX_SIZE + 1024 * 1024,
  });

  const buffer = Buffer.from(res.data);
  if (buffer.length > MAX_SIZE) throw new Error("Video terlalu besar (maks 80MB)");
  if (buffer.length < 1000) throw new Error("File video tidak valid");

  fs.writeFileSync(dest, buffer);
  return dest;
}

// ─── Uploader (dicoba berurutan; kalau satu gagal / tidak bisa diunduh API, lanjut ke berikutnya) ───
const UPLOADERS = [
  {
    name: "litterbox",
    async upload(filePath) {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      form.append("time", "1h");
      form.append("fileToUpload", fs.createReadStream(filePath), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });
      const { data } = await axios.post("https://litterbox.catbox.moe/resources/internals/api.php", form, {
        timeout: 150000,
        maxBodyLength: Infinity,
        headers: { ...form.getHeaders(), "User-Agent": UA },
      });
      return typeof data === "string" ? data.trim() : "";
    },
  },
  {
    name: "catbox",
    async upload(filePath) {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      form.append("fileToUpload", fs.createReadStream(filePath), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });
      const { data } = await axios.post("https://catbox.moe/user/api.php", form, {
        timeout: 150000,
        maxBodyLength: Infinity,
        headers: { ...form.getHeaders(), "User-Agent": UA },
      });
      return typeof data === "string" ? data.trim() : "";
    },
  },
  {
    name: "uguu",
    async upload(filePath) {
      const form = new FormData();
      form.append("files[]", fs.createReadStream(filePath), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });
      const { data } = await axios.post("https://uguu.se/upload?output=json", form, {
        timeout: 150000,
        maxBodyLength: Infinity,
        headers: { ...form.getHeaders(), "User-Agent": UA },
      });
      return data?.files?.[0]?.url || "";
    },
  },
  {
    name: "tmpfiles",
    async upload(filePath) {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), {
        filename: "video.mp4",
        contentType: "video/mp4",
      });
      const { data } = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
        timeout: 150000,
        maxBodyLength: Infinity,
        headers: { ...form.getHeaders(), "User-Agent": UA },
      });
      const url = data?.data?.url || "";
      // ubah ke link download langsung
      return url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
    },
  },
];

// Panggil API HD. Mengembalikan Buffer video hasil.
async function callHdApi(publicUrl, mode) {
  const apiUrl = `${API}?url=${encodeURIComponent(publicUrl)}&mode=${mode}`;

  const res = await axios.get(apiUrl, {
    responseType: "arraybuffer",
    timeout: 240000,
    maxContentLength: 120 * 1024 * 1024,
    headers: { "User-Agent": UA },
    validateStatus: () => true,
  });

  let buf = Buffer.from(res.data);
  const contentType = String(res.headers["content-type"] || "").toLowerCase();
  const looksJson = contentType.includes("json") || buf.subarray(0, 1).toString() === "{";

  if (looksJson) {
    let json;
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      throw new Error("Respons API tidak valid");
    }

    if (json.status === false || json.success === false || json.error) {
      throw new Error(json.message || json.error || "API mengembalikan error");
    }

    const resultUrl =
      json.result?.url || json.result?.video || (typeof json.result === "string" ? json.result : null) ||
      json.url || json.download || json.data?.url || (typeof json.data === "string" ? json.data : null);
    if (!resultUrl) throw new Error("API tidak memberikan link hasil video");

    const dl = await axios.get(resultUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: 120 * 1024 * 1024,
      headers: { "User-Agent": UA },
    });
    buf = Buffer.from(dl.data);
  } else if (res.status >= 400) {
    throw new Error(`API error HTTP ${res.status}`);
  }

  if (buf.length < 1000) throw new Error("Hasil video terlalu kecil / tidak valid");
  return buf;
}

// Upload + proses, ganti uploader otomatis kalau API gagal mengunduh link-nya
async function enhanceVideo(inputPath, mode) {
  let lastErr = null;

  for (const up of UPLOADERS) {
    let url;
    try {
      url = await up.upload(inputPath);
      if (!/^https?:\/\//i.test(url)) throw new Error(`upload ${up.name} gagal`);
    } catch (e) {
      console.error(`[HDVID] uploader ${up.name}:`, e.message);
      lastErr = e;
      continue;
    }

    try {
      return await callHdApi(url, mode);
    } catch (e) {
      console.error(`[HDVID] API via ${up.name}:`, e.message);
      lastErr = e;
      // hanya lanjut ke uploader lain kalau masalahnya API tidak bisa mengunduh link
      if (!/unduh|download|link|url|fetch|timeout|ECONN|ENOTFOUND/i.test(String(e.message))) throw e;
    }
  }

  throw lastErr || new Error("Semua server upload gagal");
}

async function processHdvid(ctx, mode, fileId) {
  let inputPath = null;
  let resultPath = null;

  const wait = await ctx.reply(
    `⏳ Memproses video...\nMode: <b>${MODES[mode]}</b>\nMohon tunggu...`,
    { parse_mode: "HTML" }
  );

  const typing = setInterval(() => ctx.sendChatAction("upload_video").catch(() => {}), 4000);

  try {
    inputPath = await downloadToFile(ctx, fileId);
    const resultBuf = await enhanceVideo(inputPath, mode);

    try { fs.unlinkSync(inputPath); } catch {}
    inputPath = null;

    resultPath = tempPath("mp4");
    fs.writeFileSync(resultPath, resultBuf);

    const caption =
      `✅ <b>HD Video Selesai</b>\n` +
      `Mode: <b>${MODES[mode]}</b>\n` +
      `Ukuran: ${formatBytes(resultBuf.length)}`;

    // Coba kirim sebagai video, kalau gagal kirim sebagai dokumen
    try {
      await ctx.replyWithVideo(
        { source: resultPath, filename: `hdvid-${mode}.mp4` },
        { caption, parse_mode: "HTML", supports_streaming: true }
      );
    } catch (e) {
      await ctx.replyWithDocument(
        { source: resultPath, filename: `hdvid-${mode}.mp4` },
        { caption: caption + "\n\n<i>(Dikirim sebagai file)</i>", parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("[HDVID ERROR]", err);
    await ctx.reply(`❌ Gagal memproses: ${escH(err.message)}`, { parse_mode: "HTML" });
  } finally {
    clearInterval(typing);
    ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    pendingVideos.delete(getKey(ctx));

    if (inputPath) try { fs.unlinkSync(inputPath); } catch {}
    if (resultPath) try { fs.unlinkSync(resultPath); } catch {}
  }
}

// Callback dari tombol
registerCallback("hdvid", async (ctx, [mode]) => {
  await ctx.answerCbQuery("Sedang memproses...").catch(() => {});
  if (!MODES[mode]) return ctx.reply("❌ Mode tidak valid");

  const key = getKey(ctx);
  const data = pendingVideos.get(key);
  if (!data?.fileId) {
    return ctx.reply("❌ Sesi video sudah expired. Silakan reply video lagi dengan /hdvid");
  }

  // cegah klik ganda selama diproses
  if (data.busy) return;
  data.busy = true;

  await processHdvid(ctx, mode, data.fileId);
});

export default {
  command: ["hdvid"],
  category: "tools",
  description: "Perjelas video blur jadi HD (hd2x / hd4x / cinematic)",
  cooldown: 20000,
  run: async (ctx) => {
    cleanOld();

    const msg = ctx.message;
    const sources = [msg, msg?.reply_to_message].filter(Boolean);
    let fileId = null;

    for (const src of sources) {
      if (src.video) fileId = src.video.file_id;
      else if (src.animation) fileId = src.animation.file_id;
      else if (src.document?.mime_type?.startsWith("video/")) fileId = src.document.file_id;
      if (fileId) break;
    }

    if (!fileId) {
      return ctx.reply(
        `📹 <b>HD Video Enhancer</b>\n\n` +
        `Reply sebuah video dengan perintah /hdvid\n` +
        `lalu pilih mode yang diinginkan.\n\n` +
        `• HD 2×\n• HD 4×\n• Cinematic\n\n` +
        `<i>Maksimal 80MB, diproses sampai 2 menit pertama.</i>`,
        { parse_mode: "HTML" }
      );
    }

    pendingVideos.set(getKey(ctx), {
      fileId,
      timestamp: Date.now(),
    });

    await ctx.reply(
      `🎬 <b>Pilih Mode HD Video</b>\n\nVideo sudah diterima. Silakan pilih mode:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "HD 2×", callback_data: "hdvid:hd2x" },
              { text: "HD 4×", callback_data: "hdvid:hd4x" },
            ],
            [{ text: "🎬 Cinematic", callback_data: "hdvid:cinematic" }],
          ],
        },
      }
    );
  },
};
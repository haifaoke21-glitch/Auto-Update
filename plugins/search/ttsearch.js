import axios from "axios";
import config from "../../config.js";
import { uploadForFileId } from "../../src/lib/scratch.js";
import { escH } from "../../src/lib/util.js";
import { maxBotApiUploadBytes } from "../../src/lib/net.js";

const TIMEOUT = 20000;
const MAX_VIDEO_BYTES = maxBotApiUploadBytes();
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s = "", n = 80) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };

const cookieFrom = (res) => (res.headers?.["set-cookie"] || []).map((c) => String(c).split(";")[0].trim()).filter(Boolean).join("; ");

/** Cari video TikTok lewat getdl.space: (1) GET /api/session, (2) POST /api/search/tiktok */
async function searchTiktok(query, count = 5) {
  const base = String(config.ttSearchApi || "https://getdl.space").replace(/\/+$/, "");
  const headers = { "User-Agent": UA, "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8", Referer: `${base}/id/search/tiktok`, Origin: base };

  const sess = await axios.get(`${base}/api/session`, { headers, timeout: TIMEOUT });
  const sessionId = sess.data?.success && sess.data.sessionId;
  if (!sessionId) throw new Error("Gagal membuat session ke server pencarian (API berubah / sedang down).");

  const cookie = cookieFrom(sess);
  const res = await axios.post(
    `${base}/api/search/tiktok`,
    { query, count, cursor: 0, region: "ID", sessionId, sortType: 0 },
    { headers: { ...headers, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, timeout: TIMEOUT, validateStatus: () => true }
  );
  if (res.status !== 200) throw new Error(`Server pencarian menolak request (HTTP ${res.status}).`);
  if (!res.data?.success || !res.data.data) throw new Error("Respons pencarian tidak sesuai format (API berubah / query ditolak).");

  const d = res.data.data;
  const videos = (Array.isArray(d.videos) ? d.videos : []).slice(0, count).map((v) => ({
    title: String(v.title || "").trim(),
    duration: Number(v.duration) || 0,
    playUrl: String(v.playUrl || ""),
  }));
  return { total: Number(d.totalResults) || videos.length, videos };
}

/** Unduh video dari playUrl; divalidasi benar-benar file video (bukan halaman error) */
async function downloadVideo(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer", timeout: 60000, maxContentLength: MAX_VIDEO_BYTES, maxBodyLength: MAX_VIDEO_BYTES,
    headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" }, validateStatus: () => true,
  }).catch((err) => {
    if (/maxContentLength|maxBodyLength/i.test(err?.message || "")) throw new Error(`Video terlalu besar (maks ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB), gunakan link di bawah.`);
    throw err;
  });
  if (res.status !== 200) throw new Error(`Unduh video gagal (HTTP ${res.status}).`);
  const buf = Buffer.from(res.data);
  const ctype = String(res.headers?.["content-type"] || "").toLowerCase();
  const looksMp4 = buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp";
  if (!looksMp4 && !ctype.startsWith("video/")) throw new Error("Link hasil pencarian bukan file video langsung.");
  if (buf.length < 10 * 1024) throw new Error("File video terlalu kecil / rusak.");
  return buf;
}

/** "supra mk4" -> semua hasil ; "supra mk4 | 3" -> hanya video nomor 3 */
function parseArgs(raw) {
  const m = String(raw || "").trim().match(/^(.*?)(?:\s*\|\s*(\d{1,2}))?$/s);
  return { query: (m?.[1] || "").trim(), index: m?.[2] ? Math.max(1, parseInt(m[2], 10)) : null };
}

/** Unduh + upload semua video (paralel terbatas) untuk dapat file_id. Yang gagal dilewati, urutan dijaga */
async function collectFileIds(ctx, videos, onProgress, concurrency = 3) {
  const items = new Array(videos.length).fill(null);
  let next = 0, done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= videos.length) return;
      const v = videos[i];
      try {
        if (!v.playUrl) throw new Error("tidak ada link video");
        const buf = await downloadVideo(v.playUrl);
        const fileId = await uploadForFileId(ctx, "video", { source: buf, filename: "tiktok.mp4" }, { supports_streaming: true, ...(v.duration ? { duration: v.duration } : {}) });
        if (!fileId) throw new Error("upload ke Telegram gagal");
        items[i] = { fileId, title: v.title, duration: v.duration };
      } catch (err) {
        console.warn(`[TTSEARCH] Video #${i + 1} dilewati:`, err.message);
      }
      done++;
      try { await onProgress?.(done, videos.length); } catch { /* abaikan */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, videos.length) }, worker));
  return items.filter(Boolean);
}

/** Rich Message: tabel judul + slideshow video yang bisa digeser */
async function sendRichSlideshow(ctx, query, items) {
  const media = items.map((it, i) => ({ id: `v${i + 1}`, media: { type: "video", media: it.fileId, supports_streaming: true, ...(it.duration ? { duration: it.duration } : {}) } }));
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${h(cut(it.title || "Video TikTok", 90))}</td><td>${it.duration ? it.duration + "s" : "-"}</td></tr>`).join("");
  const html =
    `<h2><tg-emoji emoji-id="5231012545799666522">🔎</tg-emoji> Hasil TikTok: ${h(query)}</h2>` +
    `<tg-slideshow>${items.map((_, i) => `<video src="tg://video?id=v${i + 1}"></video>`).join("")}</tg-slideshow>` +
    `<table bordered striped><tr><th>#</th><th>Judul</th><th>Durasi</th></tr>${rows}</table>` +
    `<p>Geser untuk melihat ${items.length} video.</p>`;
  const extra = ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  await ctx.telegram.callApi("sendRichMessage", {
    chat_id: ctx.chat.id,
    rich_message: { html, media },
    reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    ...extra,
  });
}

const linkList = (query, total, videos) =>
  `<tg-emoji emoji-id="5231012545799666522">🔎</tg-emoji> <b>Hasil TikTok:</b> <code>${h(query)}</code>\nDitemukan ${total} video (menampilkan ${videos.length})\n\n` +
  videos.map((v, i) => {
    const t = h(cut(v.title || "Tanpa judul", 60));
    const d = v.duration ? ` · ${v.duration}s` : "";
    return v.playUrl ? `${i + 1}. <a href="${h(v.playUrl)}">${t}</a>${d}` : `${i + 1}. ${t}${d}`;
  }).join("\n");

export default {
  command: ["ttsearch"],
  category: "search",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Cari video TikTok, hasil berupa slideshow. Contoh: /ttsearch supra mk4  |  1 video: /ttsearch supra mk4 | 3",
  cooldown: 20000,
  run: async (ctx, { text }) => {
    const { query, index } = parseArgs(text);
    if (!query) {
      return ctx.reply(
        "Cara pakai:\n/ttsearch kata kunci → semua hasil (maks 5 video) jadi slideshow yang bisa digeser\n" +
        "/ttsearch kata kunci | 3 → hanya video nomor 3\n\nContoh: /ttsearch supra mk4"
      );
    }

    const wait = await ctx.reply(`<tg-emoji emoji-id="5231012545799666522">🔎</tg-emoji> Mencari video TikTok: ${escH(query)} ...`, { parse_mode: "HTML" });
    const setWait = (t) => ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, t).catch(() => {});
    try {
      const { total, videos } = await searchTiktok(query, 5);
      if (!videos.length) return await ctx.reply(`<tg-emoji emoji-id="5372825386591732174">📭</tg-emoji> Tidak ada video TikTok untuk "${escH(query)}". Coba kata kunci lain.`, { parse_mode: "HTML" });

      // ── Mode 1 video: "kata | N" ──
      if (index !== null) {
        if (index > videos.length) return await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Video #${escH(index)} tidak ada. Hasil untuk "${escH(query)}" hanya ${escH(videos.length)} video.`, { parse_mode: "HTML" });
        const v = videos[index - 1];
        try {
          await setWait(`⏳ Mengirim video #${index} ...`);
          const buf = await downloadVideo(v.playUrl);
          await ctx.replyWithVideo({ source: buf, filename: "tiktok.mp4" }, {
            caption: `<tg-emoji emoji-id="5388724152930708079">🎬</tg-emoji> <b>${h(cut(v.title || "Video TikTok", 200))}</b>\n<tg-emoji emoji-id="5231012545799666522">🔎</tg-emoji> <code>${h(query)}</code> · ${index}/${videos.length}` + (v.duration ? ` · ${v.duration}s` : ""),
            parse_mode: "HTML", duration: v.duration || undefined, supports_streaming: true,
          });
        } catch (err) {
          await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal mengirim videonya: ${err.message}\n\n` + linkList(query, total, videos), { parse_mode: "HTML", disable_web_page_preview: true });
        }
        return;
      }

      // ── Mode semua: slideshow ──
      await setWait(`⏳ Mengambil video untuk "${query}" ... 0/${videos.length}`);
      const items = await collectFileIds(ctx, videos, (d, all) => setWait(`⏳ Mengambil video untuk "${query}" ... ${d}/${all}`));
      if (!items.length) {
        return await ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Tidak ada video yang berhasil diambil.\n\n" + linkList(query, total, videos), { parse_mode: "HTML", disable_web_page_preview: true });
      }
      try {
        await sendRichSlideshow(ctx, query, items);
      } catch (err) {
        console.warn("[TTSEARCH] Rich Message gagal, kirim album video:", err?.message);
        const cap = (it, i) => `🎬 ${i + 1}/${items.length} · ${h(cut(it.title || "Video TikTok", 150))}`;
        if (items.length === 1) await ctx.replyWithVideo(items[0].fileId, { caption: cap(items[0], 0), parse_mode: "HTML" });
        else await ctx.replyWithMediaGroup(items.map((it, i) => ({ type: "video", media: it.fileId, caption: cap(it, i), parse_mode: "HTML" })));
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal mencari video TikTok: ${escH(err.message)}\nLayanan pihak ketiga mungkin sedang bermasalah.`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

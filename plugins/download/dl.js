import config from "../../config.js";
import { isUrl, getBuffer, escH } from "../../src/lib/util.js";
import { sendFromUrl } from "../../src/lib/send.js";
import { fetchDownload, pickBest } from "../../src/lib/aiodl.js";

/**
 * Downloader universal via api.theresav.eu (config.js -> aio), tanpa solver captcha.
 * Link apa pun yang didukung server (TikTok, IG, FB, YouTube, dll) bisa dipakai di semua command di bawah;
 * command hanya menentukan media yang diutamakan (audio / video).
 */
const MAP = {
  dl: { prefer: "video", host: /.*/ },
  aio: { prefer: "video", host: /.*/ },
  ytmp3: { prefer: "audio", host: /youtu/i },
  ytmp4: { prefer: "video", host: /youtu/i },
  ig: { prefer: "video", host: /instagram\.com/i },
  igdl: { prefer: "video", host: /instagram\.com/i },
  fb: { prefer: "video", host: /facebook\.com|fb\.watch|fb\.com/i },
  fbdl: { prefer: "video", host: /facebook\.com|fb\.watch|fb\.com/i },
};

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s = "", n = 900) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };

export default {
  command: Object.keys(MAP),
  category: "download",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Download dari link apa saja: /dl <url>  |  /ytmp3 /ytmp4 /ig /fb (API di config.js → aio)",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    const raw = (ctx.message.text || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    const cfg = MAP[cmd];
    if (!cfg) return;
    if (!isUrl(text) || !cfg.host.test(text)) return ctx.reply(`Contoh: /${cmd} <url${cmd === "dl" || cmd === "aio" ? "" : " yang sesuai"}>`);

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Sedang memproses...", { parse_mode: "HTML" });
    try {
      const { title, medias } = await fetchDownload(text.trim());
      const caption = title ? `<tg-emoji emoji-id="5388724152930708079">🎬</tg-emoji> <b>${h(cut(title))}</b>` : undefined;
      const opt = { caption, parse_mode: "HTML" };

      const D = { detect: true }; // jenis kiriman disesuaikan dengan isi file (foto / video / musik)
      const video = pickBest(medias, "video");
      const audio = pickBest(medias, "audio");
      const imgs = medias.filter((m) => m.kind === "image").slice(0, 10);
      const sendAudio = () => sendFromUrl(ctx, audio.url, "audio", { ...opt, ...D, title: title ? cut(title, 60) : undefined, filename: "audio.mp3" });
      const sendVideo = () => sendFromUrl(ctx, video.url, "video", { ...opt, ...D, filename: "video.mp4" });

      // /ytmp3 -> musik dulu; selain itu video dulu
      if (cfg.prefer === "audio" && audio) return await sendAudio();
      if (video) return await sendVideo();

      // Postingan foto (mis. slide TikTok / carousel IG): semua foto dikirim sebagai album, lalu musiknya
      if (imgs.length) {
        if (imgs.length === 1) await sendFromUrl(ctx, imgs[0].url, "photo", { ...opt, ...D });
        else {
          const files = await Promise.all(imgs.map((m) => getBuffer(m.url)));
          await ctx.replyWithMediaGroup(files.map((source, i) => ({ type: "photo", media: { source }, ...(i === 0 && caption ? { caption, parse_mode: "HTML" } : {}) })));
        }
        if (audio) await sendAudio().catch(() => {});
        return;
      }
      if (audio) return await sendAudio();
      throw new Error("Tidak ada media yang bisa dikirim.");
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

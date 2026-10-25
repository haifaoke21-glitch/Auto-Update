import { getJson, isUrl, esc, escH } from "../../src/lib/util.js";
import { sendFromUrl } from "../../src/lib/send.js";

export default {
  command: ["tiktok", "tt", "ttmp3"],
  category: "download",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Download video TikTok tanpa watermark. /tiktok <url>  |  /ttmp3 <url> untuk audio",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    const raw = (ctx.message.text || "").trim();
    const cmd = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    if (!isUrl(text) || !/tiktok\.com/i.test(text)) return ctx.reply("Contoh: /tiktok https://vt.tiktok.com/xxxx");

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Mengambil data...", { parse_mode: "HTML" });
    try {
      const json = await getJson("https://www.tikwm.com/api/", { url: text, hd: 1 });
      const d = json?.data;
      if (!d) throw new Error(json?.msg || "Data tidak ditemukan");

      const caption = `<tg-emoji emoji-id="5463107823946717464">🎵</tg-emoji> <b>${escH(d.title || "TikTok")}</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${escH(d.author?.nickname || "-")}`;
      if (cmd === "ttmp3") {
        await sendFromUrl(ctx, d.music, "audio", { title: d.music_info?.title, filename: "tiktok.mp3" });
      } else if (Array.isArray(d.images) && d.images.length) {
        // Post slideshow foto
        for (const img of d.images.slice(0, 10)) await sendFromUrl(ctx, img, "photo");
        await ctx.replyWithHTML(caption);
      } else {
        await sendFromUrl(ctx, d.hdplay || d.play, "video", { caption, parse_mode: "HTML", filename: "tiktok.mp4" });
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal mengunduh: ${escH(err.message)}`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

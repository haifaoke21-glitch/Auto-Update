import axios from "axios";
import { esc, escH } from "../../src/lib/util.js";

const TIMEOUT = 45000;

/** Screenshot website via microlink.io (gratis tanpa API key, ada rate limit per IP) */
async function screenshot(url) {
  const { data } = await axios.get("https://api.microlink.io", {
    params: { url, screenshot: true, meta: false },
    timeout: TIMEOUT,
  });
  const shotUrl = data?.data?.screenshot?.url;
  if (!shotUrl) throw new Error(data?.message || "API tidak mengembalikan screenshot (URL target mungkin tidak valid).");
  const img = await axios.get(shotUrl, { responseType: "arraybuffer", timeout: TIMEOUT });
  return Buffer.from(img.data);
}

export default {
  command: ["ssweb"],
  category: "utility",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Screenshot halaman website. Contoh: /ssweb https://example.com",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    let target = (text || "").trim();
    if (!target) return ctx.reply("Contoh: /ssweb https://example.com");
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    try {
      const u = new URL(target);
      if (!u.hostname.includes(".")) throw new Error("bad host");
    } catch {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> URL tidak valid. Contoh: /ssweb https://example.com", { parse_mode: "HTML" });
    }

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Mengambil screenshot...", { parse_mode: "HTML" });
    try {
      const buffer = await screenshot(target);
      const caption = `<tg-emoji emoji-id="6120946172010959542">🖼️</tg-emoji> <b>Screenshot</b>\n<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> ${escH(target)}`;
      try {
        await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: "HTML" });
      } catch {
        // foto terlalu besar/dimensi tidak valid -> kirim sebagai dokumen
        await ctx.replyWithDocument({ source: buffer, filename: "screenshot.png" }, { caption, parse_mode: "HTML" });
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal screenshot: ${escH(err.message)}`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

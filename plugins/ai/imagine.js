import axios from "axios";
import { generateImage, imagineReady } from "../../src/lib/imagefree.js";
import { escH } from "../../src/lib/util.js";

// Filter konten: bot publik tidak membuat gambar eksplisit seksual (apalagi yang melibatkan anak/remaja).
const EXPLICIT = /\b(nsfw|nude|naked|nudes?|porn\w*|hentai|sex\w*|erotic\w*|topless|bottomless|nipples?|genital\w*|penis|vagina|pussy|boobs?|bugil|telanjang|porno|mesum|ngentot|toket|memek|kontol)\b/i;
const MINOR = /\b(loli\w*|shota|child|children|kid|kids|minor|underage|teen|teenage\w*|schoolgirl|schoolboy|anak|bocah|remaja|sd|smp)\b/i;

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default {
  command: ["imagine"],
  category: "ai",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Buat gambar dengan AI. Contoh: /imagine kucing astronot di bulan",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    if (!imagineReady()) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Fitur pembuat gambar belum aktif. Owner perlu mengisi imagine.apiUrl di config.js.", { parse_mode: "HTML" });
    if (!text) return ctx.reply("Contoh: /imagine kucing astronot di bulan\nTips: makin detail deskripsinya, makin bagus hasilnya.");

    const prompt = text.trim().slice(0, 500);
    if (!prompt) return ctx.reply("Contoh: /imagine kucing astronot di bulan");
    if (EXPLICIT.test(prompt) || (MINOR.test(prompt) && /\b(sexy|seksi|lingerie|bikini|swimsuit)\b/i.test(prompt))) {
      return ctx.reply("<tg-emoji emoji-id=\"5240241223632954241\">🚫</tg-emoji> Prompt ditolak: bot ini tidak membuat gambar eksplisit/seksual.", { parse_mode: "HTML" });
    }

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5395444784611480792\">🎨</tg-emoji> Sedang membuat gambar, tunggu sekitar 10–90 detik...", { parse_mode: "HTML" });
    const typing = setInterval(() => ctx.sendChatAction("upload_photo").catch(() => {}), 4500);
    ctx.sendChatAction("upload_photo").catch(() => {});
    try {
      const { url } = await generateImage(prompt);
      const extra = { caption: `<tg-emoji emoji-id="5395444784611480792">🎨</tg-emoji> ${h(prompt.slice(0, 200))}`, parse_mode: "HTML" };
      try {
        await ctx.replyWithPhoto(url, extra);
      } catch {
        // Telegram gagal mengambil URL langsung -> unduh sendiri lalu kirim sebagai file
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
        await ctx.replyWithPhoto({ source: Buffer.from(res.data) }, extra);
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat gambar: ${escH(err.response?.data?.message || err.message)}`, { parse_mode: "HTML" });
    } finally {
      clearInterval(typing);
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

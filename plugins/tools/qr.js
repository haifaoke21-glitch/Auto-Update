import { escH } from "../../src/lib/util.js";
export default {
  command: ["qr"],
  category: "tools",
  description: "Buat QR code dari teks/link. Contoh: /qr https://contoh.com",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /qr https://contoh.com");
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=10&data=${encodeURIComponent(text)}`;
    try {
      await ctx.replyWithPhoto(url, { parse_mode: "HTML", caption: "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> QR code siap" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat QR: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

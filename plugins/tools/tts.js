import { getBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["tts"],
  category: "tools",
  description: "Teks jadi suara. Contoh: /tts id Halo semua  (bahasa default id)",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    let lang = "id";
    let body = args.join(" ");
    if (/^[a-z]{2}$/i.test(args[0] || "") && args.length > 1) {
      lang = args[0].toLowerCase();
      body = args.slice(1).join(" ");
    }
    if (!body) return ctx.reply("Contoh: /tts id Halo semua");
    if (body.length > 200) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Maksimal 200 karakter.", { parse_mode: "HTML" });
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(body)}`;
      const source = await getBuffer(url);
      await ctx.replyWithAudio({ source, filename: "tts.mp3" }, { title: "TTS" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat suara: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

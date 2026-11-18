import { callApi, callApiTry, resolveFile, NEXRAY } from "../../src/lib/xapi.js";
import { escH } from "../../src/lib/util.js";

// Endpoint dari permintaan: /ai/gemini-tt. Kalau 404, otomatis coba /ai/gemini-tts.
const PATHS = ["/ai/gemini-tt", "/ai/gemini-tts"];

export default {
  command: ["geminitts"],
  category: "ai",
  loading: false,
  loadingAction: "record_voice",
  description: "Buat pembicaraan dengan Gemini TTS. Contoh: /geminitts Halo, apa kabar?",
  cooldown: 8000,
  run: async (ctx, { text }) => {
    const quoted = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || "";
    const body = (text || quoted || "").trim().slice(0, 1000);
    if (!body) return ctx.reply("Contoh: /geminitts Halo, apa kabar?\nAtau balas sebuah pesan dengan /geminitts");

    ctx.sendChatAction("record_voice").catch(() => {});
    try {
      let r, lastErr;
      for (const p of PATHS) {
        try { r = await callApiTry(NEXRAY, p, [{ text: body }, { q: body }, { prompt: body }]); break; }
        catch (e) { lastErr = e; if (e.status !== 404) throw e; }
      }
      if (!r) throw lastErr;
      const out = await resolveFile(r);
      await ctx.replyWithAudio({ source: out.buf, filename: "geminitts.mp3" }, { title: "Gemini TTS" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat suara: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

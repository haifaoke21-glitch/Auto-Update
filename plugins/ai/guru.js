import { callApiTry, findText, XRINA, replyLong } from "../../src/lib/xapi.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["guru"],
  category: "ai",
  description: "Belajar bareng Guru AI (matematika, sains, bahasa, sejarah, coding). Contoh: /guru jelaskan hukum Newton",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    const quoted = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || "";
    const question = [text, quoted && `\n\n${quoted}`].filter(Boolean).join("");
    if (!question) return ctx.reply("Contoh: /guru jelaskan hukum Newton 1\nAtau balas soal dengan /guru");

    ctx.sendChatAction("typing").catch(() => {});
    try {
      const q = question.slice(0, 3000);
      const r = await callApiTry(XRINA, "/ai/guru", [{ text: q }, { q }, { prompt: q }, { query: q }]);
      const answer = r.json ? findText(r.json) : r.text;
      await replyLong(ctx, answer);
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Guru AI error: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

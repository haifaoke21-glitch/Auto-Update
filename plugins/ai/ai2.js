import { callApiTry, findText, XRINA, replyLong } from "../../src/lib/xapi.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["ai2"],
  category: "ai",
  description: "Tanya jawab dengan DeepAI Chat. Contoh: /ai apa itu blockchain?",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    const reply = ctx.message.reply_to_message;
    const quoted = reply?.text || reply?.caption || "";
    const question = [text, quoted && `\n\nKonteks dari pesan yang dibalas:\n${quoted}`].filter(Boolean).join("");
    if (!question) return ctx.reply("Contoh: /ai jelaskan apa itu API\nAtau balas sebuah pesan dengan /ai ringkas ini");

    ctx.sendChatAction("typing").catch(() => {});
    try {
      const q = question.slice(0, 3000);
      const r = await callApiTry(XRINA, "/ai/deepai", [{ text: q }, { q }, { prompt: q }, { query: q }]);
      const answer = r.json ? findText(r.json) : r.text;
      await replyLong(ctx, answer);
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> AI error: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

import { chat, aiReady } from "../../src/lib/ai.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["ringkas"],
  category: "ai",
  description: "Ringkas teks. Balas pesan panjang dengan /ringkas",
  cooldown: 8000,
  run: async (ctx, { text }) => {
    if (!aiReady()) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Fitur AI belum aktif. Owner perlu mengisi ai.apiKey di config.js.", { parse_mode: "HTML" });
    const body = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || text;
    if (!body) return ctx.reply("Balas pesan yang mau diringkas dengan /ringkas, atau: /ringkas <teks>");
    ctx.sendChatAction("typing").catch(() => {});
    try {
      const out = await chat([
        { role: "system", content: "Ringkas teks berikut menjadi poin-poin singkat dalam bahasa yang sama dengan teksnya." },
        { role: "user", content: body.slice(0, 12000) },
      ]);
      await ctx.reply(`<tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> ${escH(String(out).slice(0, 3900))}`, { parse_mode: "HTML" });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> AI error: ${escH(err.response?.data?.error?.message || err.message)}`, { parse_mode: "HTML" });
    }
  },
};

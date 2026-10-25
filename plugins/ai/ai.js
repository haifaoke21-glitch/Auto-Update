import { chat, aiReady, getMemory, pushMemory } from "../../src/lib/ai.js";
import { getMediaBuffer, escH } from "../../src/lib/util.js";
import config from "../../config.js";

const NOT_READY = "⚠️ Fitur AI belum aktif. Owner perlu mengisi ai.apiKey di config.js.";

export default {
  command: ["ai"],
  category: "ai",
  description: "Tanya AI (ingat 4 percakapan terakhir). Bisa balas foto untuk analisis gambar. Contoh: /ai apa itu blockchain?",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    if (!aiReady()) return ctx.reply(NOT_READY);
    const reply = ctx.message.reply_to_message;
    const quoted = reply?.text || reply?.caption || "";
    const question = [text, quoted && `\n\nKonteks dari pesan yang dibalas:\n${quoted}`].filter(Boolean).join("");
    const photo = await getMediaBuffer(ctx, ["photo"]);
    if (!question && !photo) return ctx.reply("Contoh: /ai jelaskan apa itu API\nAtau balas sebuah foto dengan /ai apa ini?");

    ctx.sendChatAction("typing").catch(() => {});
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    try {
      let userContent = question;
      if (photo) {
        userContent = [
          { type: "text", text: question || "Jelaskan gambar ini." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${photo.toString("base64")}` } },
        ];
      }
      const messages = [
        { role: "system", content: config.ai.systemPrompt },
        ...getMemory(key),
        { role: "user", content: userContent },
      ];
      // Foto dianalisis dengan model vision; teks biasa memakai model teks
      const answer = await chat(messages, photo ? { model: config.ai.visionModel || config.ai.model } : undefined);
      pushMemory(key, "user", question || "[gambar]");
      pushMemory(key, "assistant", answer);
      // Telegram membatasi 4096 karakter per pesan
      for (let i = 0; i < answer.length; i += 4000) await ctx.reply(answer.slice(i, i + 4000));
    } catch (err) {
      const status = err.response?.status;
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> AI error${escH(status ? ` (${status})` : "")}: ${escH(err.response?.data?.error?.message || err.message)}`, { parse_mode: "HTML" });
    }
  },
};

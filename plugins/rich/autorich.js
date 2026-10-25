import { generateRichBlocks } from "../../src/lib/richAuto.js";
import { entitiesToMarkers } from "../../src/lib/richEmoji.js";
import { sendRichBlocks } from "../../src/lib/richSend.js";
import { h } from "../../src/lib/rich.js";
import { aiReady } from "../../src/lib/ai.js";
import config from "../../config.js";

const usage = (p) =>
  `<tg-emoji emoji-id="6123129707614441341">✨</tg-emoji> <b>Cara pakai ${h(p)}autorich</b>\n\n` +
  `<b>Balas</b> pesan yang mau dijadikan Rich Message, lalu ketik <code>${h(p)}autorich</code>.\n` +
  `AI menyusun isinya otomatis: heading, paragraf, tabel, kutipan, expandable, footer, dan tombol (kalau ada link di teksnya).\n\n` +
  `Mau mengatur hasilnya? Tambahkan instruksi di belakang perintah:\n` +
  `<code>${h(p)}autorich fokus ke tabel perbandingan</code>\n` +
  `<code>${h(p)}autorich bahasa inggris</code>\n\n` +
  `<tg-emoji emoji-id="6120946172010959542">📷</tg-emoji> Kalau yang dibalas <b>foto + caption</b>, fotonya ikut dipasang di atas Rich Message.`;

// Autorich memakai AI khusus (config.rich.autorich) atau jatuh ke AI bawaan (config.ai)
const ready = () => Boolean(String(config.rich?.autorich?.baseUrl || "").trim() ? config.rich.autorich.apiKey : aiReady());

export default {
  command: ["autorich"],
  category: "rich",
  description: "Balas pesan lalu AI otomatis menjadikannya Rich Message lengkap (tabel, quote, expandable, tombol). Contoh: balas teks + /autorich",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply(usage(config.prefix), { parse_mode: "HTML" });
    if (!ready()) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Fitur AI belum aktif. Owner perlu mengisi <code>ai.apiKey</code> (atau <code>rich.autorich</code>) di config.js.", { parse_mode: "HTML" });

    const source = entitiesToMarkers(reply.text ?? reply.caption ?? "", reply.entities ?? reply.caption_entities).trim();
    if (!source) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Pesan yang kamu balas tidak ada teksnya. Balas pesan <b>teks</b> (atau foto yang ada caption-nya).", { parse_mode: "HTML" });

    const status = await ctx.reply("⏳ AI lagi menyusun Rich Message...", { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } }).catch(() => null);
    const cleanup = () => (status ? ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {}) : null);
    ctx.sendChatAction("typing").catch(() => {});

    try {
      const photoId = reply.photo?.at(-1)?.file_id || null;
      const { blocks, markup } = await generateRichBlocks(source, text);
      console.log("[AUTORICH] markup dari AI:\n" + markup);
      await sendRichBlocks(ctx, blocks, photoId);
      await cleanup();
    } catch (err) {
      console.error("[AUTORICH]", err?.message);
      await cleanup();
      if (err.code === "NOT_CONFIGURED") return ctx.reply("⚠️ Fitur AI belum aktif. Owner perlu mengisi config AI di config.js.");
      if (err.code === "PARSE_FAILED") return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> AI gagal menyusun format Rich Message yang valid (sudah dicoba 2x).\n\n<code>${h(err.message)}</code>\n\nCoba kirim ulang perintahnya.`, { parse_mode: "HTML" });
      await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal membuat Rich Message otomatis.\n\n<code>${h(err.message)}</code>`, { parse_mode: "HTML" });
    }
  },
};

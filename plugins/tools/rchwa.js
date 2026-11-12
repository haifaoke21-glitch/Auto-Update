import { getJson, escH } from "../../src/lib/util.js";

export default {
  command: ["rchwa"],
  category: "tools",
  description: "React postingan channel WhatsApp dengan satu atau beberapa emoji.",
  run: async (ctx, { text }) => {
    const raw = String(text || "").trim();
    if (!raw) {
      return ctx.replyWithHTML(
        `<b>React Channel WA</b>\n\n` +
        `React postingan channel WhatsApp dengan satu atau beberapa emoji.\n\n` +
        `Contoh:\n<code>/rchwa https://whatsapp.com/channel/xxxxx ❤️</code>`
      );
    }

    // Ambil URL, sisanya dianggap emoji
    const urlMatch = raw.match(/https?:\/\/\S+/i);
    if (!urlMatch) {
      return ctx.reply("Masukkan link channel WhatsApp yang valid.\nContoh: /rchwa https://whatsapp.com/channel/xxxxx ❤️");
    }
    const link = urlMatch[0];
    let emojiPart = raw.replace(link, "").trim();

    // Dukung format emoji=xxx
    const emojiEq = emojiPart.match(/emoji\s*=\s*(.+)/i);
    if (emojiEq) emojiPart = emojiEq[1].trim();

    const emojis = emojiPart
      .split(/[\s|,]+/)
      .map(e => e.trim())
      .filter(Boolean);

    if (!emojis.length) {
      return ctx.reply("Masukkan minimal satu emoji.\nContoh: /rchwa https://whatsapp.com/channel/xxxxx ❤️");
    }

    // Beberapa emoji digabung dengan "|"
    const emojiParam = emojis.join("|");

    try {
      const apiUrl = "https://api-cloud.my.id/tools/rchv2";
      const data = await getJson(apiUrl, { link, emoji: emojiParam });
      if (!data?.status) {
        throw new Error(data?.error || "Gagal react channel");
      }

      await ctx.replyWithHTML(
        `✅ <b>React Channel WA</b>\n\n` +
        `Link: ${escH(link)}\n` +
        `Emoji: ${emojis.map(e => escH(e)).join(" ")}`
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal react channel WA: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};
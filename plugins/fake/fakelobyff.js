import { getBuffer, escH, isUrl } from "../../src/lib/util.js";

async function resolveAvatar(ctx, provided) {
  if (provided && isUrl(provided)) return provided;
  const msg = ctx.message?.reply_to_message || ctx.message;
  const fileId = msg?.photo?.at(-1)?.file_id;
  if (fileId) {
    try {
      const link = await ctx.telegram.getFileLink(fileId);
      return link.href;
    } catch {}
  }
  return null;
}

export default {
  command: ["fakelobyff"],
  category: "fake",
  description: "Buat fake Lobby FF.",
  run: async (ctx, { text }) => {
    const parts = (text || "").split("|").map(s => s.trim()).filter(Boolean);
    if (!parts.length) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Lobby FF</b>\n\n` +
        `Contoh:\n<code>/fakelobyff Nickname</code>`
      );
    }
    const nickname = parts[0];
    let avatar = parts[1] && isUrl(parts[1]) ? parts[1] : await resolveAvatar(ctx, null);
    // API hanya butuh nickname, avatar opsional
    let url = `https://api.nexray.eu.cc/maker/fakelobyff?nickname=${encodeURIComponent(nickname)}`;
    if (avatar) url += `&avatar=${encodeURIComponent(avatar)}`;

    try {
      const buf = await getBuffer(url);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Lobby FF: <b>${escH(nickname)}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Lobby FF: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

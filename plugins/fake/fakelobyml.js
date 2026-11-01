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
  command: ["fakelobyml"],
  category: "fake",
  description: "Buat fake Lobby ML.",
  run: async (ctx, { text }) => {
    const parts = (text || "").split("|").map(s => s.trim()).filter(Boolean);
    if (!parts.length) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Lobby ML</b>\n\n` +
        `Contoh:\n<code>/fakelobyml Nickname | https://i.pravatar.cc/150</code>\n\n` +
        `Atau reply foto + <code>/fakelobyml Nickname</code>`
      );
    }
    const nickname = parts[0];
    let avatar = parts[1] && isUrl(parts[1]) ? parts[1] : await resolveAvatar(ctx, null);
    if (!avatar) avatar = "https://i.pravatar.cc/150";

    try {
      const url = `https://api.nexray.eu.cc/maker/fakelobyml?nickname=${encodeURIComponent(nickname)}&avatar=${encodeURIComponent(avatar)}`;
      const buf = await getBuffer(url);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Lobby ML: <b>${escH(nickname)}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Lobby ML: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

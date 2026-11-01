import { getBuffer, escH, isUrl, getMediaBuffer } from "../../src/lib/util.js";

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
  command: ["fakestory"],
  category: "fake",
  description: "Buat fake Story.",
  run: async (ctx, { text }) => {
    const parts = (text || "").split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Story</b>\n\n` +
        `Contoh:\n<code>/fakestory username | https://i.pravatar.cc/150 | Caption keren</code>\n\n` +
        `Atau reply foto + <code>/fakestory username | caption</code>`
      );
    }
    let username = parts[0];
    let avatar = null;
    let caption = "";
    if (parts.length >= 3 && isUrl(parts[1])) {
      avatar = parts[1];
      caption = parts.slice(2).join(" | ");
    } else {
      caption = parts.slice(1).join(" | ");
      avatar = await resolveAvatar(ctx, null);
    }
    if (!avatar) avatar = "https://i.pravatar.cc/150";
    if (!caption) return ctx.reply("❌ Caption wajib diisi.");

    try {
      const url = `https://api.nexray.eu.cc/maker/fakestory?username=${encodeURIComponent(username)}&avatar=${encodeURIComponent(avatar)}&caption=${encodeURIComponent(caption)}`;
      const buf = await getBuffer(url);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Story oleh <b>${escH(username)}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Story: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

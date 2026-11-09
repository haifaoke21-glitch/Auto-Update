import { resolveBlChat, removeFromBlacklist, getBlacklist, esc } from "../../src/lib/cfd.js";

export default {
  command: ["unbl"],
  category: "owner",
  description: "Keluarkan chat dari blacklist /cfd (ketik di grupnya, atau /unbl <chat_id>)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const chat = await resolveBlChat(ctx, args[0]);
    if (!chat) {
      return ctx.reply(
        "Ketik /unbl langsung di grup yang mau dikeluarkan,\natau dari mana saja: /unbl <chat_id>\nLihat daftar ID dengan /listbl"
      );
    }
    // Pakai nama yang tersimpan di blacklist kalau ada (lebih akurat daripada nama saat ini)
    const saved = getBlacklist().find((it) => String(it.id) === chat.id);
    const title = saved?.title || chat.title;
    const { removed, total } = await removeFromBlacklist(chat.id);
    const name = `<b>${esc(title)}</b> (<code>${esc(chat.id)}</code>)`;
    await ctx.reply(
      removed
        ? `${name} dikeluarkan dari blacklist CFD.\nTotal blacklist: ${total}`
        : `${name} tidak ada di blacklist CFD.\nTotal blacklist: ${total}`,
      { parse_mode: "HTML" }
    );
  },
};

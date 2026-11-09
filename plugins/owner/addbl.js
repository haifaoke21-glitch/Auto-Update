import { resolveBlChat, addToBlacklist, esc } from "../../src/lib/cfd.js";

export default {
  command: ["addbl"],
  category: "owner",
  description: "Blacklist chat dari /cfd (ketik di grupnya, atau /addbl <chat_id>)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const chat = await resolveBlChat(ctx, args[0]);
    if (!chat) {
      return ctx.reply(
        "Ketik /addbl langsung di grup yang mau di-blacklist,\natau dari mana saja: /addbl <chat_id>\nContoh: /addbl -1001234567890"
      );
    }
    const { added, total } = await addToBlacklist(chat.id, chat.title);
    const name = `<b>${esc(chat.title)}</b> (<code>${esc(chat.id)}</code>)`;
    await ctx.reply(
      added
        ? `${name} masuk blacklist CFD.\nTotal blacklist: ${total}`
        : `${name} sudah ada di blacklist CFD.\nTotal blacklist: ${total}`,
      { parse_mode: "HTML" }
    );
  },
};

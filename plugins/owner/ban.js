import { usersDb, saveUser } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["bans"],
  category: "owner",
  description: "Ban user dari memakai bot (balas pesan user atau /bans <id>)",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const targetId = ctx.message.reply_to_message?.from?.id || args[0];
    if (!targetId) return ctx.reply("Balas pesan user atau ketik /bans <user_id>");

    await saveUser(targetId, { banned: true });
    await ctx.reply(`<tg-emoji emoji-id="5240241223632954241">🚫</tg-emoji> User ${escH(targetId)} telah dibanned dari penggunaan bot.`, { parse_mode: "HTML" });
  },
};

import { saveUser } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["unban"],
  category: "owner",
  description: "Unban user (balas pesan user atau /unban <id>)",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const targetId = ctx.message.reply_to_message?.from?.id || args[0];
    if (!targetId) return ctx.reply("Balas pesan user atau ketik /unban <user_id>");

    await saveUser(targetId, { banned: false });
    await ctx.reply(`<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> User ${escH(targetId)} telah di-unban.`, { parse_mode: "HTML" });
  },
};

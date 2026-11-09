import { ownerDb } from "../../src/database.js";
import { allOwnerIds } from "../../src/middleware.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["addowner"],
  category: "owner",
  description: "Menambahkan owner baru (langsung aktif, tanpa restart)",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const targetId = args[0] || ctx.message.reply_to_message?.from?.id;
    if (!targetId || !/^\d+$/.test(String(targetId))) {
      return ctx.reply("Contoh: /addowner 123456789\n(atau balas pesan user dengan /addowner)");
    }
    const id = String(targetId);
    if (allOwnerIds().includes(id)) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> ID tersebut sudah menjadi owner.", { parse_mode: "HTML" });

    ownerDb.data.owner ||= [];
    ownerDb.data.owner.push(id);
    await ownerDb.write();
    await ctx.reply(`<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> ID ${escH(id)} sekarang menjadi owner.`, { parse_mode: "HTML" });
  },
};

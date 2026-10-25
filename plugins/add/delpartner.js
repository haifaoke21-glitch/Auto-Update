import { partnerDb } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["delpt"],
  category: "add",
  description: "Hapus status Partner dari user",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const id = String(args[0] || ctx.message.reply_to_message?.from?.id || "");
    if (!/^\d+$/.test(id)) return ctx.reply("Contoh: /delpt 123456789");

    const list = partnerDb.data.partner || [];
    if (!list.includes(id)) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> ID tersebut bukan Partner.", { parse_mode: "HTML" });

    partnerDb.data.partner = list.filter((x) => x !== id);
    await partnerDb.write();
    await ctx.reply(`<tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> ID ${escH(id)} dihapus dari Partner.`, { parse_mode: "HTML" });
  },
};

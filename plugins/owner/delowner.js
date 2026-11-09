import config from "../../config.js";
import { ownerDb } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["delowner"],
  category: "owner",
  description: "Hapus owner tambahan (owner utama di config.js tidak bisa dihapus dari sini)",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const id = String(args[0] || ctx.message.reply_to_message?.from?.id || "");
    if (!/^\d+$/.test(id)) return ctx.reply("Contoh: /delowner 123456789");
    if (config.ownerIds.map(String).includes(id)) {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Itu owner utama. Hapus lewat file config.js.", { parse_mode: "HTML" });
    }
    const list = ownerDb.data.owner || [];
    if (!list.includes(id)) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> ID tersebut bukan owner tambahan.", { parse_mode: "HTML" });
    ownerDb.data.owner = list.filter((x) => x !== id);
    await ownerDb.write();
    await ctx.reply(`<tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> ID ${escH(id)} dihapus dari owner.`, { parse_mode: "HTML" });
  },
};

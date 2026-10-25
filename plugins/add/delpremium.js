import { premiumDb } from "../../src/database.js";
import { isOwner, isPartner } from "../../src/middleware.js";
import { escH } from "../../src/lib/util.js";

function canUsePremiumTools(userId) {
  return isOwner(userId) || isPartner(userId);
}

export default {
  command: ["delprem"],
  category: "add",
  description: "Hapus status Premium dari user (Partner ke atas)",
  ownerOnly: false,
  run: async (ctx, { args }) => {
    if (!canUsePremiumTools(ctx.from.id)) {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Fitur ini hanya tersedia untuk Partner ke atas.", { parse_mode: "HTML" });
    }

    const id = String(args[0] || ctx.message.reply_to_message?.from?.id || "");
    if (!/^\d+$/.test(id)) return ctx.reply("Contoh: /delprem 123456789");

    const list = premiumDb.data.premium || [];
    if (!list.includes(id)) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> ID tersebut bukan Premium.", { parse_mode: "HTML" });

    premiumDb.data.premium = list.filter((x) => x !== id);
    await premiumDb.write();
    await ctx.reply(`<tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> ID ${escH(id)} dihapus dari Premium.`, { parse_mode: "HTML" });
  },
};

import { premiumDb } from "../../src/database.js";
import { isOwner, isPartner, isPremium } from "../../src/middleware.js";
import { escH } from "../../src/lib/util.js";

function canUsePremiumTools(userId) {
  return isOwner(userId) || isPartner(userId);
}

export default {
  command: ["prem"],
  category: "add",
  description: "Menjadikan user sebagai Premium (Partner ke atas, langsung aktif tanpa restart)",
  ownerOnly: false,
  run: async (ctx, { args }) => {
    if (!canUsePremiumTools(ctx.from.id)) {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Fitur ini hanya tersedia untuk Partner ke atas.", { parse_mode: "HTML" });
    }

    const targetId = args[0] || ctx.message.reply_to_message?.from?.id;
    if (!targetId || !/^\d+$/.test(String(targetId))) {
      return ctx.reply("Contoh: /prem 123456789\n(atau balas pesan user dengan /prem)");
    }
    const id = String(targetId);
    if (isPremium(id)) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> ID tersebut sudah menjadi Premium.", { parse_mode: "HTML" });

    premiumDb.data.premium ||= [];
    premiumDb.data.premium.push(id);
    await premiumDb.write();
    await ctx.reply(`<tg-emoji emoji-id="5427168083074628963">💎</tg-emoji> ID ${escH(id)} sekarang menjadi Premium.`, { parse_mode: "HTML" });
  },
};

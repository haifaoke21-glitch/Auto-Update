import { partnerDb } from "../../src/database.js";
import { isPartner } from "../../src/middleware.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["pt"],
  category: "add",
  description: "Menjadikan user sebagai Partner (langsung aktif, tanpa restart)",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const targetId = args[0] || ctx.message.reply_to_message?.from?.id;
    if (!targetId || !/^\d+$/.test(String(targetId))) {
      return ctx.reply("Contoh: /pt 123456789\n(atau balas pesan user dengan /pt)");
    }
    const id = String(targetId);
    if (isPartner(id)) return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> ID tersebut sudah menjadi Partner.", { parse_mode: "HTML" });

    partnerDb.data.partner ||= [];
    partnerDb.data.partner.push(id);
    await partnerDb.write();
    await ctx.reply(`<tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> ID ${escH(id)} sekarang menjadi Partner.`, { parse_mode: "HTML" });
  },
};

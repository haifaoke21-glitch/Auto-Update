import { claimDaily, formatWait } from "../../src/lib/coin.js";
import config from "../../config.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["claim"],
  category: "user",
  description: "Klaim koin gratis harian (1x per hari)",
  run: async (ctx) => {
    const r = claimDaily(ctx.from.id);
    if (!r.ok) {
      return ctx.reply(`<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Kamu sudah claim hari ini.\nCoba lagi ${escH(formatWait(r.wait))} lagi (reset tiap tengah malam ${escH(config.coin?.timezone || "Asia/Jakarta")}).`, { parse_mode: "HTML" });
    }
    await ctx.reply(`<tg-emoji emoji-id="6327875261085783004">🎁</tg-emoji> Claim berhasil! +${escH(r.amount)} coin\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin kamu: ${escH(r.koin)}`, { parse_mode: "HTML" });
  },
};

import { restartProcess } from "../../src/lib/restart.js";

export default {
  command: ["restart"],
  category: "owner",
  description: "Restart bot (butuh process manager seperti pm2)",
  ownerOnly: true,
  run: async (ctx) => {
    await ctx.reply("<tg-emoji emoji-id=\"5348125953090403204\">🔄</tg-emoji> Merestart bot...", { parse_mode: "HTML" });
    // pm2 / systemd / docker: kode 0. Panel Pterodactyl: kode non-0 supaya server menyala lagi (lihat src/lib/restart.js).
    restartProcess(500);
  },
};

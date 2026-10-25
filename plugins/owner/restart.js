export default {
  command: ["restart"],
  category: "owner",
  description: "Restart bot (butuh process manager seperti pm2)",
  ownerOnly: true,
  run: async (ctx) => {
    await ctx.reply("<tg-emoji emoji-id=\"5348125953090403204\">🔄</tg-emoji> Merestart bot...", { parse_mode: "HTML" });
    // Exit code 0 supaya pm2 / systemd / docker restart policy men-start ulang proses.
    // Jalankan bot dengan: pm2 start index.js --name lyric-tg
    setTimeout(() => process.exit(0), 500);
  },
};

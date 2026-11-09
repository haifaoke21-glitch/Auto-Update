import { statsDb, usersDb, groupsDb } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["stats"],
  category: "main",
  description: "Menampilkan statistik pemakaian bot",
  run: async (ctx) => {
    const totalUsers = Object.keys(usersDb.data.users || {}).length;
    const totalGroups = Object.keys(groupsDb.data.groups || {}).length;
    const totalCommand = statsDb.data.totalCommand || 0;

    const topCommands = Object.entries(statsDb.data.commands || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cmd, count], i) => `${i + 1}. ${cmd} — ${count}x`)
      .join("\n");

    await ctx.replyWithHTML(
      `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Statistik Bot</b>\n\n` +
        `<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Total user tercatat: ${escH(totalUsers)}\n` +
        `<tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Total grup terdaftar: ${escH(totalGroups)}\n` +
        `<tg-emoji emoji-id="5341715473882955310">⚙️</tg-emoji> Total perintah dijalankan: ${escH(totalCommand)}\n\n` +
        `<tg-emoji emoji-id="6008118472066732010">🔥</tg-emoji> <b>Top 5 command:</b>\n${escH(topCommands || "-")}`
    );
  },
};

import { saveUser, getUser } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["daftar"],
  category: "user",
  description: "Daftar sebagai user bot. Contoh: /daftar Nama Lengkap",
  run: async (ctx, { text }) => {
    const user = getUser(ctx.from.id);
    if (user.registered) return ctx.reply("<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> Kamu sudah terdaftar sebelumnya.", { parse_mode: "HTML" });
    if (!text) return ctx.reply("Contoh: /daftar Nama Lengkap");

    await saveUser(ctx.from.id, { registered: true, name: text });
    await ctx.reply(`<tg-emoji emoji-id="6327875261085783004">🎉</tg-emoji> Pendaftaran berhasil! Selamat datang, ${escH(text)}.`, { parse_mode: "HTML" });
  },
};

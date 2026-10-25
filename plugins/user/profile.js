import { getUser } from "../../src/database.js";
import { escH } from "../../src/lib/util.js";

export default {
  command: ["profile"],
  category: "user",
  description: "Menampilkan profil kamu",
  run: async (ctx) => {
    const user = getUser(ctx.from.id);
    await ctx.replyWithHTML(
      `<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> <b>Profil Kamu</b>\n\nNama: ${escH(user.name || "-")}\nStatus: ${user.registered ? "Terdaftar" : "Belum daftar"}\nKoin: ${escH(user.koin)}\nLevel: ${escH(user.level)}\nExp: ${escH(user.exp)}`
    );
  },
};

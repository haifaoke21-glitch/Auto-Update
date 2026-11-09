import { getUser } from "../../src/database.js";
import { addCoin, findUserByUsername } from "../../src/lib/coin.js";
import { escH } from "../../src/lib/util.js";

const MAX_GIVE = 1_000_000_000;

export default {
  command: ["giveaway"],
  category: "owner",
  description: "Bagi-bagi coin ke user. Balas pesan: /giveaway 500  |  /giveaway 500 @username  |  /giveaway 500 <id>",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const usage =
      "Contoh:\n" +
      "• Balas pesan user: /giveaway 500\n" +
      "• Via username: /giveaway 500 @username\n" +
      "• Via ID: /giveaway 500 123456789";

    let list = [...args];
    // izinkan urutan terbalik: /giveaway @username 500
    if (list.length >= 2 && (list[0].startsWith("@") || (!/^\d{1,9}$/.test(list[0]) && /^\d{1,9}$/.test(list[1])))) {
      list = [list[1], list[0]];
    }
    const [amountRaw, targetRaw] = list;

    if (!amountRaw || !/^\d+$/.test(amountRaw)) return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Jumlah coin tidak valid.\n\n${escH(usage)}`, { parse_mode: "HTML" });
    const amount = parseInt(amountRaw, 10);
    if (amount < 1 || amount > MAX_GIVE) return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Jumlah coin harus 1 - ${escH(MAX_GIVE.toLocaleString("id-ID"))}.`, { parse_mode: "HTML" });

    // Tentukan target: reply > @username > id
    let targetId = null;
    let targetName = "";
    let targetUsername = "";
    const replied = ctx.message.reply_to_message?.from;

    if (replied) {
      if (replied.is_bot) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Tidak bisa memberi coin ke bot.", { parse_mode: "HTML" });
      targetId = String(replied.id);
      targetName = [replied.first_name, replied.last_name].filter(Boolean).join(" ");
      targetUsername = replied.username || "";
    } else if (targetRaw && targetRaw.startsWith("@")) {
      const found = findUserByUsername(targetRaw);
      if (!found) {
        return ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> User ${escH(targetRaw)} tidak ditemukan. Dia harus pernah memakai bot ini dulu, atau pakai ID / balas pesannya.`, { parse_mode: "HTML" });
      }
      targetId = String(found.id);
      targetName = found.name || "";
      targetUsername = found.username || "";
    } else if (targetRaw && /^\d{5,}$/.test(targetRaw)) {
      targetId = targetRaw;
    } else {
      return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Target belum ditentukan.\n\n${escH(usage)}`, { parse_mode: "HTML" });
    }

    const before = getUser(targetId);
    if (!targetName) targetName = before.name || "";
    if (!targetUsername) targetUsername = before.username || "";
    const total = addCoin(targetId, amount);

    const who = `${targetName || "User"}${targetUsername ? ` (@${targetUsername})` : ""} [${targetId}]`;
    await ctx.reply(`<tg-emoji emoji-id="6327875261085783004">🎁</tg-emoji> Giveaway coin berhasil!\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Penerima: ${escH(who)}\n<tg-emoji emoji-id="5397916757333654639">➕</tg-emoji> Coin: +${escH(amount)}\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin penerima: ${escH(total)}`, { parse_mode: "HTML" });

    // Kabari penerima lewat chat pribadi (gagal kalau dia belum pernah /start bot, tidak masalah)
    ctx.telegram
      .sendMessage(targetId, `<tg-emoji emoji-id="6327875261085783004">🎁</tg-emoji> Kamu mendapat giveaway +${escH(amount)} coin dari owner!\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin kamu: ${escH(total)}`, { parse_mode: "HTML" })
      .catch(() => {});
  },
};

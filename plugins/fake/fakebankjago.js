import { getBuffer, escH } from "../../src/lib/util.js";

export default {
  command: ["fakebankjago"],
  category: "fake",
  description: "Buat fake Bank Jago.",
  run: async (ctx, { text }) => {
    const parts = (text || "").split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Bank Jago</b>\n\n` +
        `Contoh:\n<code>/fakebankjago Budi Santoso | 2500000</code>`
      );
    }
    const nama = parts[0];
    const saldo = parts[1].replace(/[^\d]/g, "");
    if (!saldo || isNaN(saldo)) return ctx.reply("❌ Saldo harus angka.");

    try {
      const url = `https://api.nexray.eu.cc/maker/fakebank-jago?nama=${encodeURIComponent(nama)}&saldo=${encodeURIComponent(saldo)}`;
      const buf = await getBuffer(url);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Bank Jago\nNama: <b>${escH(nama)}</b>\nSaldo: <b>Rp ${Number(saldo).toLocaleString("id-ID")}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Bank Jago: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

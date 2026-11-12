import { getJson, escH } from "../../src/lib/util.js";

function dataUriToBuffer(dataUri) {
  const match = String(dataUri).match(/^data:[^;]+;base64,(.+)$/);
  if (!match) throw new Error("Response bukan data URI valid");
  return Buffer.from(match[1], "base64");
}

export default {
  command: ["fakeffduo"],
  category: "fake",
  description: "Buat fake lobby Free Fire mode duo. Tulis 2 nickname (bar kiri & kanan).",
  run: async (ctx, { text }) => {
    const parts = (text || "").split(/[|,]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return ctx.replyWithHTML(
        `🎮 <b>Fake FF Duo</b>\n\n` +
        `Tulis 2 nickname di lobby Free Fire mode duo (bar kiri & kanan).\n\n` +
        `Contoh:\n<code>/fakeffduo Player1 | Player2</code>`
      );
    }
    const name1 = parts[0];
    const name2 = parts[1];

    try {
      const apiUrl = "https://api-cloud.my.id/maker/fakeffduo";
      const data = await getJson(apiUrl, { name1, name2 });
      if (!data?.status || !data.result) {
        throw new Error(data?.error || "API mengembalikan respons tidak valid");
      }
      const buf = dataUriToBuffer(data.result);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake FF Duo\nKiri: <b>${escH(name1)}</b>\nKanan: <b>${escH(name2)}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake FF Duo: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

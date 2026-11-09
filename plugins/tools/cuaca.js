import { getJson, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["cuaca"],
  category: "tools",
  description: "Cek cuaca kota. Contoh: /cuaca Surabaya",
  run: async (ctx, { text }) => {
    if (!text) return ctx.reply("Contoh: /cuaca Surabaya");
    try {
      const j = await getJson(`https://wttr.in/${encodeURIComponent(text)}`, { format: "j1", lang: "id" });
      const c = j.current_condition[0];
      const area = j.nearest_area?.[0]?.areaName?.[0]?.value || text;
      const desc = c.lang_id?.[0]?.value || c.weatherDesc?.[0]?.value || "-";
      await ctx.replyWithHTML(
        `🌤 <b>Cuaca ${escH(area)}</b>\n\n${escH(desc)}\n🌡 Suhu: ${escH(c.temp_C)}°C (terasa ${escH(c.FeelsLikeC)}°C)\n<tg-emoji emoji-id="5848268374949239239">💧</tg-emoji> Kelembapan: ${escH(c.humidity)}%\n<tg-emoji emoji-id="5190716144721340004">💨</tg-emoji> Angin: ${escH(c.windspeedKmph)} km/jam`
      );
    } catch {
      await ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Kota tidak ditemukan atau layanan cuaca sedang bermasalah.", { parse_mode: "HTML" });
    }
  },
};

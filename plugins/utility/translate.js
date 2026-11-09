import { getJson, esc, escH } from "../../src/lib/util.js";

export default {
  command: ["translate"],
  category: "utility",
  description: "Terjemahkan teks. Contoh: /tr en selamat pagi  (atau balas pesan: /tr id)",
  run: async (ctx, { args }) => {
    const reply = ctx.message.reply_to_message;
    const lang = (args[0] || "id").toLowerCase();
    const body = reply?.text || reply?.caption || args.slice(1).join(" ");
    if (!body || !/^[a-z]{2}(-[a-z]{2})?$/i.test(lang)) {
      return ctx.reply("Contoh: /tr en selamat pagi\nAtau balas sebuah pesan dengan /tr id");
    }
    try {
      const json = await getJson("https://translate.googleapis.com/translate_a/single", {
        client: "gtx", sl: "auto", tl: lang, dt: "t", q: body,
      });
      const out = json[0].map((s) => s[0]).join("");
      const from = json[2] || "?";
      await ctx.replyWithHTML(`<tg-emoji emoji-id="5447410659077661506">🌐</tg-emoji> <b>${escH(from)} → ${escH(lang)}</b>\n\n${escH(out)}`);
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal menerjemahkan: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

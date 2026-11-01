import { sendRandom } from "../../src/lib/randomImg.js";
import "./Vietnam.js"; import "./Thailand.js"; import "./Korea.js"; import "./Japan.js"; import "./Indonesia.js"; import "./Chinese.js";

// /cecan            -> pilih negara lewat tombol
// /cecan <negara>   -> langsung kirim (vietnam, thailand, korea, japan, indonesia, china)
const COUNTRIES = { vietnam: ["Vietnam", "🇻🇳"], thailand: ["Thailand", "🇹🇭"], korea: ["Korea", "🇰🇷"], japan: ["Japan", "🇯🇵"], indonesia: ["Indonesia", "🇮🇩"], china: ["China", "🇨🇳"] };
const ALIAS = { vn: "vietnam", th: "thailand", kr: "korea", jp: "japan", jepang: "japan", id: "indonesia", indo: "indonesia", cn: "china", chinese: "china" };

const markup = () => {
  const e = Object.entries(COUNTRIES), rows = [];
  for (let i = 0; i < e.length; i += 2) rows.push(e.slice(i, i + 2).map(([k, [n, f]]) => ({ text: `${f} ${n}`, callback_data: `rnd:cecan_${k}` })));
  rows.push([{ text: "❌ Tutup", callback_data: "rnd:x" }]);
  return { inline_keyboard: rows };
};

export default {
  command: ["cecan"],
  category: "random",
  description: "Foto cecan acak: /cecan lalu pilih negara, atau /cecan korea",
  cooldown: 5000,
  run: async (ctx, { args = [] } = {}) => {
    if (!args[0]) return ctx.reply("🎲 <b>Random Cecan</b>\nPilih negara:", { parse_mode: "HTML", reply_markup: markup() });
    const k = String(args[0]).toLowerCase();
    const country = COUNTRIES[k] ? k : ALIAS[k];
    if (!country) return ctx.reply(`❌ Negara tidak dikenal. Pilih: ${Object.keys(COUNTRIES).join(", ")}`, { reply_markup: markup() });
    try {
      await sendRandom(ctx, `cecan_${country}`, { replyTo: ctx.message?.message_id });
    } catch (err) {
      await ctx.reply(`❌ Gagal mengambil gambar: ${err.message}`);
    }
  },
};

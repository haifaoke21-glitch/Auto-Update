import { esc, escH } from "../../src/lib/util.js";

function score(a, b) {
  const s = [a, b].map((x) => x.toLowerCase().trim()).sort().join("|");
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 101;
  return h;
}

export default {
  command: ["jodoh", "ship"],
  category: "fun",
  description: "Ramal kecocokan dua nama. Contoh: /jodoh Budi|Siti",
  run: async (ctx, { text }) => {
    const [a, b] = text.split("|").map((x) => x?.trim());
    if (!a || !b) return ctx.reply("Format: /jodoh Nama1|Nama2");
    const s = score(a, b);
    const bar = "❤️".repeat(Math.round(s / 10)) + "🖤".repeat(10 - Math.round(s / 10));
    await ctx.replyWithHTML(`<tg-emoji emoji-id="4956269706987177066">💘</tg-emoji> <b>Kecocokan</b>\n\n${escH(a)} × ${escH(b)}\n${escH(bar)}\n<b>${escH(s)}%</b>`);
  },
};

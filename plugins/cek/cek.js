import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { esc, displayName, escH } from "../../src/lib/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cekList = JSON.parse(fs.readFileSync(path.join(__dirname, "cek-list.json"), "utf-8"));

const TIERS = [
  [90, "Maksimal banget! 🔥"],
  [70, "Tinggi sekali 😎"],
  [50, "Lumayan lah 👍"],
  [30, "Biasa aja sih 😅"],
  [0, "Masih rendah, semangat 🤭"],
];

// Persentase konsisten per nama + command + tanggal (berubah tiap hari)
function seededPercent(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 101;
}

export default {
  command: Object.keys(cekList),
  category: "cek",
  description: "Cek persentase bertema (balas pesan orang untuk cek dia)",
  run: async (ctx, { command }) => {
    const raw = (ctx.message.text || ctx.message.caption || "").trim();
    const cmdUsed = raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    const meta = cekList[cmdUsed] || { label: "Persentase", emoji: "🔮" };

    const target = ctx.message.reply_to_message?.from || ctx.from;
    const name = displayName(target);
    const today = new Date().toISOString().slice(0, 10);
    const percent = seededPercent(`${target.id}${cmdUsed}${today}`);
    const filled = Math.round(percent / 10);
    const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
    const comment = TIERS.find(([min]) => percent >= min)[1];

    await ctx.replyWithHTML(
      `${escH(meta.emoji)} <b>${escH(meta.label)}</b>\n\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${escH(name)}\n[${escH(bar)}] ${escH(percent)}%\n<i>${escH(comment)}</i>`
    );
  },
};

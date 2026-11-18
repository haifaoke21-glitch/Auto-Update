import { callApiTry, resolveFile, NEXRAY } from "../../src/lib/xapi.js";
import { escH } from "../../src/lib/util.js";

// Format: /dracintts teks, speed, volume, musik
// Yang tidak diisi memakai default: speed 1.0, volume 0.3, musik true
const DEFAULT = { speed: 1.0, volume: 0.3, music: "true" };

const isNum = (s) => /^\d+(\.\d+)?$/.test(s);
const isBool = (s) => /^(true|false|on|off|ya|tidak|yes|no|1|0)$/i.test(s);
const toBool = (s) => (/^(true|on|ya|yes|1)$/i.test(s) ? "true" : "false");

/** Ambil bagian belakang (speed, volume, musik) dari input; sisanya jadi teks. Koma di dalam teks tetap aman. */
function parseInput(raw) {
  const parts = raw.split(",").map((s) => s.trim());
  const out = { ...DEFAULT };
  if (parts.length >= 4 && isNum(parts.at(-3)) && isNum(parts.at(-2)) && isBool(parts.at(-1))) {
    out.speed = Number(parts.at(-3)); out.volume = Number(parts.at(-2)); out.music = toBool(parts.at(-1));
    return { text: parts.slice(0, -3).join(", "), ...out };
  }
  if (parts.length >= 3 && isNum(parts.at(-2)) && isNum(parts.at(-1))) {
    out.speed = Number(parts.at(-2)); out.volume = Number(parts.at(-1));
    return { text: parts.slice(0, -2).join(", "), ...out };
  }
  if (parts.length >= 2 && isNum(parts.at(-1))) {
    out.speed = Number(parts.at(-1));
    return { text: parts.slice(0, -1).join(", "), ...out };
  }
  return { text: raw.trim(), ...out };
}

export default {
  command: ["dracintts"],
  category: "ai",
  loading: false,
  loadingAction: "record_voice",
  description: "Buat suara dracin. Format: /dracintts teks, speed, volume, musik",
  cooldown: 8000,
  run: async (ctx, { text }) => {
    const raw = (text || "").trim() || (ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || "").trim();
    if (!raw) {
      return ctx.reply(
        "Format: /dracintts teks, speed, volume, musik\n\nContoh:\n/dracintts Halo apa kabar"
      );
    }
    const { text: body, speed, volume, music } = parseInput(raw);
    if (!body) return ctx.reply("Teksnya kosong. Contoh: /dracintts Halo apa kabar, 1.0, 0.3, true");

    ctx.sendChatAction("record_voice").catch(() => {});
    try {
      const r = await callApiTry(NEXRAY, "/ai/dracin-tts", [{ text: body.slice(0, 1000), speed, volume, music }]);
      const out = await resolveFile(r);
      await ctx.replyWithAudio({ source: out.buf, filename: "dracin.mp3" }, { title: "Dracin TTS", caption: `speed ${speed} • volume ${volume} • musik ${music}` });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat suara: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

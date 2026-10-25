// plugins/tools/enc.js
// Obfuscate kode JavaScript lewat API eksternal (config.js -> obfuscator).
// Command: /enclow, /encmedium, /enchigh (dulu /enc <level>, lalu /encode).

import { obfuscateCode, obfuscatorReady } from "../../src/lib/obfuscator.js";
import { readCodeFromCtx, checkSyntax } from "../../src/lib/jsSyntax.js";
import { escH } from "../../src/lib/util.js";

const OK = `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>`;
const NO = `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>`;
const WARN = `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>`;
const WAIT = `<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji>`;
const html = { parse_mode: "HTML" };

const running = new Set(); // satu proses /enc* per user

const LEVEL_BY_CMD = { enclow: "low", encmedium: "medium", enchigh: "high" };

// Command tidak dikirim ke run(), jadi deteksi sendiri dari teks pesan asli (sama seperti plugin multi-command lain)
function invokedCommand(ctx) {
  const raw = (ctx.message.text || ctx.message.caption || "").trim();
  return raw.replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
}

export default {
  command: ["enclow", "encmedium", "enchigh"],
  category: "tools",
  description: `obfuscate kode/file JS, Reply file .js atau teks kode, lalu kirim perintahnya.`,
  cooldown: 15000,
  loading: false,
  run: async (ctx) => {
    if (!obfuscatorReady()) {
      return ctx.reply(`${WARN} Fitur ini belum aktif. Owner perlu mengisi obfuscator.apiUrl & obfuscator.apiKey di config.js.`, html);
    }

    const cmd = invokedCommand(ctx);
    const level = LEVEL_BY_CMD[cmd] || "medium";

    let input;
    try {
      input = await readCodeFromCtx(ctx);
    } catch (err) {
      return ctx.reply(`${NO} Gagal membaca file: ${escH(err.message)}`, html);
    }
    if (!input) {
      return ctx.reply(
        `${WARN} <b>Cara pakai</b>\n\nReply file <code>.js</code> atau pesan teks berisi kode, lalu kirim <code>/${escH(cmd)}</code>.\nBisa juga kirim file dengan caption <code>/${escH(cmd)}</code>.\n\nLevel lain: <code>/enclow</code> | <code>/encmedium</code> | <code>/enchigh</code>.`,
        html
      );
    }
    if (input.error) return ctx.reply(`${NO} ${escH(input.error)}`, html);

    const { code, fileName } = input;

    const uid = ctx.from.id;
    if (running.has(uid)) return ctx.reply(`${WARN} Proses obfuscate sebelumnya masih berjalan, tunggu selesai dulu.`, html);

    const before = await checkSyntax(code).catch(() => null);
    if (before && !before.valid) {
      return ctx.reply(`${NO} Kode punya syntax error (baris ${before.error.line ?? "?"}): ${escH(before.error.message)}\nPerbaiki dulu kodenya (bisa pakai /fixerror) sebelum di-obfuscate.`, html);
    }

    running.add(uid);
    const chatId = ctx.chat.id;
    const status = await ctx.reply(`${WAIT} Mengobfuscate kode (level: ${escH(level)})...`, html).catch(() => null);
    const typing = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);

    let result;
    try {
      result = await obfuscateCode(code, level);
    } catch (err) {
      clearInterval(typing);
      running.delete(uid);
      if (status) ctx.telegram.deleteMessage(chatId, status.message_id).catch(() => {});
      return ctx.reply(`${NO} Gagal obfuscate: ${escH(err.message)}`, html);
    }

    clearInterval(typing);
    running.delete(uid);
    if (status) ctx.telegram.deleteMessage(chatId, status.message_id).catch(() => {});

    if (!result || !result.trim()) {
      return ctx.reply(`${NO} API obfuscator tidak mengembalikan hasil.`, html);
    }

    const base = fileName.replace(/\.(js|mjs|cjs|txt)$/i, "").replace(/^enc_/, "");
    const outName = `enc_${base}.js`;
    const caption = `${OK} <b>Obfuscate selesai</b>\nFile: <code>${escH(fileName)}</code>\nLevel: <code>${escH(level)}</code>\n\n${WARN} Cek dulu hasilnya sebelum dipakai di produksi.`;

    await ctx.replyWithDocument({ source: Buffer.from(result, "utf-8"), filename: outName }, { caption, parse_mode: "HTML" });
  },
};

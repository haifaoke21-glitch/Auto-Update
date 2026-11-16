import axios from "axios";
import { escH } from "../../src/lib/util.js";
import { registerCallback } from "../../src/lib/callbacks.js";

const API = "https://apiii-xrina.my.id/fun/pap";

const CAPTION = `📸 <b>PAP RANDOM</b>`;
const KEYBOARD = {
  inline_keyboard: [[{ text: "🔄 Lagi", callback_data: "pap2:again" }]],
};

async function fetchPap() {
  const res = await axios.get(API, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const buffer = Buffer.from(res.data);
  if (buffer.length < 1000) throw new Error("Gambar tidak valid");
  return buffer;
}

async function sendPap(ctx) {
  const wait = await ctx.reply("⏳ Mengambil pap...", { parse_mode: "HTML" });
  try {
    const buffer = await fetchPap();
    await ctx.replyWithPhoto(
      { source: buffer },
      {
        caption: CAPTION,
        parse_mode: "HTML",
        reply_markup: KEYBOARD,
      }
    );
  } catch (err) {
    await ctx.reply(`❌ Gagal mengambil pap: ${escH(err.message)}`, { parse_mode: "HTML" });
  } finally {
    ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
  }
}

// Tombol 🔄 : hapus foto lama, lalu kirim pap baru
registerCallback("pap2", async (ctx) => {
  await ctx.answerCbQuery("Mengambil pap baru...").catch(() => {});
  const old = ctx.callbackQuery?.message;
  // hapus foto lama; kalau gagal (mis. bot tidak punya izin), setidaknya hilangkan tombolnya
  const deleted = await ctx.deleteMessage().then(() => true).catch(() => false);
  if (!deleted && old) {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  }
  await sendPap(ctx);
});

export default {
  command: ["pap2"],
  category: "random",
  description: "Gambar pap acak",
  cooldown: 5000,
  run: async (ctx) => {
    await sendPap(ctx);
  },
};
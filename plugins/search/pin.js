import axios from "axios";
import crypto from "crypto";
import config from "../../config.js";
import { getBuffer, escH } from "../../src/lib/util.js";
import { registerCallback } from "../../src/lib/callbacks.js";

const DEFAULT_API = "https://api.siputzx.my.id/api/s/pinterest";
const PAGE_SIZE = 10;
const MAX_RESULTS = 50; // 5 halaman
const SESSION_TTL = 15 * 60 * 1000;

const sessions = new Map(); // token -> { userId, query, results, mode, createdAt }

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ha = (s = "") => h(s).replace(/"/g, "&quot;");
const notModified = (e) => /message is not modified/i.test(e?.message || "");

function cleanup() {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.createdAt > SESSION_TTL) sessions.delete(t);
}

async function searchPinterest(query) {
  const { data } = await axios.get(config.pinterestApi || DEFAULT_API, { params: { query, type: "image" }, timeout: 20000 });
  const items = (Array.isArray(data?.data) ? data.data : [])
    .filter((v) => v?.image_url)
    .slice(0, MAX_RESULTS)
    .map((v) => ({ title: v.title || "", imageUrl: v.image_url }));
  if (!items.length) throw new Error("Tidak ada gambar yang ditemukan.");
  return items;
}

function pageOf(s, start) {
  const slice = s.results.slice(start, start + PAGE_SIZE);
  if (!slice.length) return null;
  return {
    slice, start,
    page: Math.floor(start / PAGE_SIZE) + 1,
    pages: Math.ceil(s.results.length / PAGE_SIZE),
    next: start + PAGE_SIZE,
    hasMore: start + PAGE_SIZE < s.results.length,
  };
}

const keyboard = (token, pg) => ({
  inline_keyboard: pg.hasMore ? [[{ text: "Next 10", icon_custom_emoji_id: "5416117059207572332", emoji_fallback: "➡️", callback_data: `pin:${token}:${pg.next}` }]] : [],
});

const richHtml = (s, pg) =>
  `<h2><tg-emoji emoji-id="5397782960512444700">📌</tg-emoji> Pinterest: ${h(s.query)}</h2>` +
  `<tg-slideshow>${pg.slice.map((it) => `<img src="${ha(it.imageUrl)}"/>`).join("")}</tg-slideshow>` +
  `<p>Halaman ${pg.page}/${pg.pages} · geser untuk melihat ${pg.slice.length} gambar.</p>`;

/** Mode Rich: slideshow yang bisa digeser + tombol Next 10 (kirim baru atau edit pesan lama) */
async function showRich(ctx, s, token, pg, editMsg) {
  const rich_message = { html: richHtml(s, pg) };
  const reply_markup = keyboard(token, pg);
  if (editMsg) {
    await ctx.telegram.callApi("editMessageText", { chat_id: editMsg.chat.id, message_id: editMsg.message_id, rich_message, reply_markup });
  } else {
    const extra = ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    await ctx.telegram.callApi("sendRichMessage", {
      chat_id: ctx.chat.id, rich_message, reply_markup,
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      ...extra,
    });
  }
}

/** Cadangan: kirim album foto biasa + pesan kecil berisi tombol Next 10 */
async function showGroup(ctx, s, token, pg) {
  const send = (media) => (media.length === 1 ? ctx.replyWithPhoto(media[0].media) : ctx.replyWithMediaGroup(media));
  const urls = pg.slice.map((it) => ({ type: "photo", media: it.imageUrl }));
  try {
    await send(urls);
  } catch {
    // Telegram gagal mengambil URL -> unduh sendiri, lewati yang gagal
    const bufs = await Promise.allSettled(pg.slice.map((it) => getBuffer(it.imageUrl, 20000)));
    const ok = bufs.filter((r) => r.status === "fulfilled").map((r) => ({ type: "photo", media: { source: r.value } }));
    if (!ok.length) throw new Error("Semua gambar gagal diambil.");
    await send(ok);
  }
  await ctx.reply(`<tg-emoji emoji-id="5397782960512444700">📌</tg-emoji> <b>${escH(s.query)}</b> — halaman ${escH(pg.page)}/${escH(pg.pages)}`, {
    parse_mode: "HTML",
    reply_markup: pg.hasMore ? keyboard(token, pg) : undefined,
  });
}

registerCallback("pin", async (ctx, [token, startRaw]) => {
  const s = sessions.get(token);
  if (!s) return ctx.answerCbQuery("⌛ Sesi pencarian sudah kedaluwarsa, ulangi /pin.", { show_alert: true });
  if (String(ctx.from.id) !== String(s.userId)) return ctx.answerCbQuery("Ini bukan hasil pencarianmu. Ketik /pin sendiri.", { show_alert: true });
  const pg = pageOf(s, parseInt(startRaw, 10) || 0);
  if (!pg) return ctx.answerCbQuery("📭 Sudah gambar terakhir.", { show_alert: true });

  const msg = ctx.callbackQuery.message;
  await ctx.answerCbQuery();
  if (s.mode === "rich") {
    try {
      return await showRich(ctx, s, token, pg, msg);
    } catch (err) {
      if (notModified(err)) return;
      console.warn("[PIN] Edit rich gagal, pindah ke album:", err?.message);
      s.mode = "group";
    }
  }
  await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {}); // hapus pesan tombol lama
  await showGroup(ctx, s, token, pg);
});

export default {
  command: ["pin"],
  category: "search",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Cari gambar Pinterest, 10 per halaman + tombol Next 10. Contoh: /pin kucing lucu",
  cooldown: 10000,
  run: async (ctx, { text }) => {
    const query = (text || "").trim();
    if (!query) return ctx.reply("Contoh: /pin kucing lucu\nHasil 10 gambar per halaman, ada tombol Next 10 untuk lanjut.");

    cleanup();
    const wait = await ctx.reply("<tg-emoji emoji-id=\"5231012545799666522\">🔎</tg-emoji> Mencari gambar Pinterest...", { parse_mode: "HTML" });
    try {
      const results = await searchPinterest(query);
      const token = crypto.randomBytes(6).toString("hex");
      const s = { userId: ctx.from.id, query, results, mode: "rich", createdAt: Date.now() };
      sessions.set(token, s);
      const pg = pageOf(s, 0);
      try {
        await showRich(ctx, s, token, pg, null);
      } catch (err) {
        console.warn("[PIN] Rich Message gagal, kirim album:", err?.message);
        s.mode = "group";
        await showGroup(ctx, s, token, pg);
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal mengambil gambar Pinterest: ${escH(err.message)}\nAPI pihak ketiga mungkin sedang bermasalah.`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

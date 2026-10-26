import config from "../../config.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import * as idPrem from "../../src/lib/idPrem.js";

// ═════════ /idprem - CEK ID EMOJI PREMIUM (kategori tools, khusus owner) ═════════
// Cara pakai:
//   1) Reply pesan berisi emoji premium            -> /idprem
//   2) Reply pack emoji (stiker emoji / link t.me/addemoji/...) -> /idprem
//   3) Langsung: /idprem <nama_pack | link_pack>
//   4) Reply emoji premium + /idprem pack          -> keluarkan satu pack-nya
// Hasil tampil 10 ID per halaman; pindah halaman pakai tombol Prev / Next (pesan yang sama
// diedit, tidak dikirim berulang). Tombol "Unduh File" mengirim SEMUA hasil cek (semua halaman) sebagai file "EmojiPrem By {namabot}.js" (1 ID per baris).

const DL_COOLDOWN = 8000;

const USAGE =
  "ℹ️ <b>/idprem</b> - cek ID emoji premium\n\n" +
  "• Reply pesan yang isinya emoji premium, lalu ketik <code>/idprem</code>\n" +
  "• Reply pack emoji (stiker emoji / link <code>t.me/addemoji/...</code>), lalu ketik <code>/idprem</code>\n" +
  "• Atau langsung: <code>/idprem NamaPack</code> / <code>/idprem link_pack</code>\n" +
  "• Reply emoji premium + <code>/idprem pack</code> = keluarkan satu pack-nya\n\n" +
  "Hasil ditampilkan 10 ID per halaman, pakai tombol Prev / Next untuk lanjut.";

const notModified = (e) => /message is not modified/i.test(e?.message || "");
const noMethod = (e) => /not found|unknown method/i.test(e?.message || "");
let richDisabled = false;
const lastDl = new Map(); // userId -> waktu unduh terakhir

// Kirim / edit satu halaman. Rich Message dulu, kalau ditolak server jatuh ke teks HTML biasa.
async function sendPage(ctx, session, token, page, replyParams) {
  const markup = idPrem.buildKeyboard(token, session.list, page);
  if (!richDisabled) {
    try {
      const msg = await ctx.telegram.callApi("sendRichMessage", {
        chat_id: ctx.chat.id,
        rich_message: idPrem.buildRichPage(session.list, session.title, page),
        reply_markup: markup,
        ...(ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
        ...replyParams,
      });
      session.mode = "rich";
      return msg;
    } catch (e) {
      if (noMethod(e)) richDisabled = true;
      console.error("[IDPREM] Rich Message gagal, pakai teks biasa:", e.message);
    }
  }
  session.mode = "legacy";
  return ctx.telegram.sendMessage(ctx.chat.id, idPrem.buildLegacyPage(session.list, session.title, page), {
    parse_mode: "HTML",
    reply_markup: markup,
    link_preview_options: { is_disabled: true },
    ...replyParams,
  });
}

async function editPage(ctx, session, token, page) {
  const { id: chatId } = ctx.callbackQuery.message.chat;
  const messageId = ctx.callbackQuery.message.message_id;
  const markup = idPrem.buildKeyboard(token, session.list, page);
  if (session.mode === "rich" && !richDisabled) {
    try {
      await ctx.telegram.callApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        rich_message: idPrem.buildRichPage(session.list, session.title, page),
        reply_markup: markup,
      });
      return;
    } catch (e) {
      if (notModified(e)) return;
      if (noMethod(e)) richDisabled = true;
      console.error("[IDPREM] edit Rich Message gagal, pakai teks biasa:", e.message);
    }
  }
  try {
    await ctx.telegram.editMessageText(chatId, messageId, undefined, idPrem.buildLegacyPage(session.list, session.title, page), {
      parse_mode: "HTML",
      reply_markup: markup,
      link_preview_options: { is_disabled: true },
    });
    session.mode = "legacy";
  } catch (e) {
    if (!notModified(e)) throw e;
  }
}

// ───────────────────────── Callback: Prev / Next / Unduh ─────────────────────────
registerCallback("idprem", async (ctx, args) => {
  const action = args[0];
  if (action === "noop") return ctx.answerCbQuery();

  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });

  const token = args[1];
  const session = idPrem.getSession(token);
  if (!session) return ctx.answerCbQuery("Sesi sudah kedaluwarsa. Ketik /idprem lagi.", { show_alert: true });
  if (session.userId !== String(ctx.from.id)) {
    return ctx.answerCbQuery("Ini hasil /idprem milik orang lain. Ketik /idprem sendiri.", { show_alert: true });
  }

  if (action === "go") {
    const page = idPrem.clampPage(args[2], session.list);
    try {
      await editPage(ctx, session, token, page);
    } catch (e) {
      console.error("[IDPREM] gagal ganti halaman:", e.message);
      return ctx.answerCbQuery("Gagal ganti halaman, coba lagi.", { show_alert: true });
    }
    return ctx.answerCbQuery();
  }

  if (action === "dl") {
    const now = Date.now();
    if (now - (lastDl.get(ctx.from.id) || 0) < DL_COOLDOWN) return ctx.answerCbQuery("Tunggu sebentar...");
    lastDl.set(ctx.from.id, now);
    await ctx.answerCbQuery("Mengirim file hasil idprem...");
    const chatId = ctx.callbackQuery.message.chat.id;
    const { text, filename, total } = idPrem.buildExportFile(session.list, session.title, config.botName);
    try {
      await ctx.telegram.sendDocument(chatId, { source: Buffer.from(text, "utf-8"), filename }, {
        caption: `📥 <b>Hasil /idprem</b>\n${total} ID emoji premium`,
        parse_mode: "HTML",
        ...(ctx.callbackQuery.message.message_thread_id ? { message_thread_id: ctx.callbackQuery.message.message_thread_id } : {}),
      });
    } catch (e) {
      console.error("[IDPREM] gagal kirim file:", e.message);
      await ctx.telegram.sendMessage(chatId, "❌ Gagal mengirim file hasil idprem, coba lagi.").catch(() => {});
    }
    return;
  }

  return ctx.answerCbQuery();
});

// ───────────────────────── Command ─────────────────────────
export default {
  command: ["idprem"],
  category: "tools",
  description: "Cek ID emoji premium dari pesan / pack emoji (10 ID per halaman, tombol Prev/Next + unduh semua hasil)",
  ownerOnly: true,
  cost: 0,
  loading: false,
  cooldown: 2000,
  run: async (ctx, { args }) => {
    try {
      const arg = (args || []).join(" ").trim();
      const replied = ctx.message.reply_to_message;
      const wantsPack = /^pack$/i.test(arg);
      const emojis = idPrem.extractCustomEmojis(replied);

      // Prioritas: arg (nama/link) > stiker yang di-reply > "pack" + emoji yang di-reply
      // > (kalau tidak ada emoji premium) link pack di pesan yang di-reply.
      let packName = wantsPack ? null : idPrem.parsePackArg(arg);
      if (!packName && replied) {
        if (replied.sticker?.set_name) {
          packName = String(replied.sticker.set_name);
        } else if (wantsPack && emojis.length) {
          const found = await ctx.telegram.getCustomEmojiStickers([emojis[0].id]);
          packName = found?.[0]?.set_name ? String(found[0].set_name) : null;
          if (!packName) return ctx.reply("❌ Emoji itu tidak punya pack yang bisa dibaca.");
        } else if (!emojis.length) {
          packName = idPrem.findPackNameInMessage(replied);
        }
      }

      let list;
      let title;
      if (packName) {
        const set = await ctx.telegram.getStickerSet(packName);
        if (!set || !Array.isArray(set.stickers)) return ctx.reply("❌ Pack emoji tidak ketemu.");
        if (set.sticker_type && set.sticker_type !== "custom_emoji") {
          return ctx.reply("❌ Itu pack stiker biasa, bukan pack emoji premium.");
        }
        list = idPrem.emojisFromStickers(set.stickers);
        title = `📦 ${set.title || set.name || packName} - ${list.length} emoji`;
      } else if (emojis.length) {
        list = emojis;
        title = `✨ ${list.length} emoji premium`;
      } else {
        return ctx.reply(USAGE, { parse_mode: "HTML" });
      }
      if (!list.length) return ctx.reply("❌ Tidak ada emoji premium yang bisa diambil.");

      const token = idPrem.createSession(ctx.from.id, list, title);
      const session = idPrem.getSession(token);
      await sendPage(ctx, session, token, 0, {
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      });
    } catch (error) {
      console.error("[IDPREM] Gagal:", error);
      const invalid = /STICKERSET_INVALID|sticker set|not found/i.test(String(error?.message));
      await ctx.reply(invalid ? "❌ Pack emoji tidak ketemu, cek lagi nama/link-nya." : "❌ Gagal ambil ID emoji, coba lagi.");
    }
  },
};

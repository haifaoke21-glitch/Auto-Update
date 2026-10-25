import axios from "axios";
import config from "../../config.js";
import { renderMemberIdCard } from "../../src/lib/CardCanvas.js";
import { buildCard } from "../../src/lib/richCard.js";
import { sendRich, h, richTable } from "../../src/lib/rich.js";
import { uploadForFileId } from "../../src/lib/scratch.js";

// ── Tampilan Rich Message (rich = Rich Message, legacy = HTML biasa kalau server belum support) ──
const noticeView = (title, message) => ({
  rich: `<div><h2>${title}</h2><blockquote>${message}</blockquote></div>`,
  legacy: `<b>${title}</b>\n\n${message}`,
});

function infoRich(rows, now) {
  const table = richTable(
    ["Field", "Detail"],
    // ID Pengguna dibuat <code> -> bisa di-tap untuk langsung ke-copy
    rows.map(([label, value]) => [h(label), label === "ID Pengguna" ? `<code>${h(value)}</code>` : h(value)])
  );
  return `<img src="tg://photo?id=idcard"/><div><h2><tg-emoji emoji-id="5843482192243594901">🔔</tg-emoji> Info User</h2>${table}<p><tg-emoji emoji-id="5969545478155539601">🕒</tg-emoji> Diambil: ${h(now)}</p></div>`;
}

// Ambil foto profil -> data URI (null kalau tidak ada / gagal; kartu otomatis pakai inisial).
async function getAvatarDataUri(telegram, userId, chatInfo) {
  const download = async (fileId) => {
    const link = await telegram.getFileLink(fileId);
    const res = await axios.get(String(link), { responseType: "arraybuffer", timeout: 15000 });
    return `data:image/jpeg;base64,${Buffer.from(res.data).toString("base64")}`;
  };
  try {
    const photos = await telegram.getUserProfilePhotos(userId, 0, 1);
    const sizes = photos?.photos?.[0];
    if (sizes?.length) return await download(sizes[sizes.length - 1].file_id);
  } catch {}
  try {
    const fileId = chatInfo?.photo?.big_file_id;
    if (fileId) return await download(fileId);
  } catch {}
  return null;
}

export default {
  command: ["id"],
  category: "tools",
  description: "Kartu info user (reply / @username / ID, kosongkan untuk dirimu sendiri)",
  loadingAction: "upload_photo",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const telegram = ctx.telegram;
    const replyTo = { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } };
    const raw = (args?.[0] || "").trim();
    let target = ctx.message.reply_to_message?.from || null;
    let chatInfo = null;

    if (!target && raw) {
      const key = /^-?\d+$/.test(raw) ? Number(raw) : raw.startsWith("@") ? raw : `@${raw}`;
      try {
        chatInfo = await telegram.getChat(key);
      } catch {
        return sendRich(
          telegram,
          ctx.chat.id,
          noticeView(
            "⚠️ User Tidak Ditemukan",
            `Gagal menemukan user "${h(raw)}". Pastikan username/ID benar (user harus pernah chat dengan bot ini), atau reply pesan orangnya langsung.`
          ),
          replyTo
        );
      }
      if (chatInfo.type !== "private") {
        const jenis = chatInfo.type === "channel" ? "Channel" : "Grup";
        const table = richTable(["Field", "Detail"], [["Nama", h(chatInfo.title || raw)], ["Tipe", jenis], ["ID", `<code>${chatInfo.id}</code>`]]);
        return sendRich(
          telegram,
          ctx.chat.id,
          {
            rich: `<div><h2><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Info ${jenis}</h2>${table}</div>`,
            legacy: `<b><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Info ${jenis}</b>\n\nNama: ${h(chatInfo.title || raw)}\nID: <code>${chatInfo.id}</code>`,
          },
          replyTo
        );
      }
      target = {
        id: chatInfo.id,
        first_name: chatInfo.first_name,
        last_name: chatInfo.last_name,
        username: chatInfo.username,
        is_bot: false,
      };
    }

    if (!target) target = ctx.from;

    try {
      if (!chatInfo) chatInfo = await telegram.getChat(target.id).catch(() => null);

      const fullName = [target.first_name, target.last_name].filter(Boolean).join(" ") || "-";
      const username = target.username ? `@${target.username}` : "-";
      const premium = target.is_premium ? "YA" : "TIDAK";
      const language = target.language_code ? String(target.language_code).toUpperCase() : "-";
      const accountType = target.is_bot ? "Bot" : "User";
      const now = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) + " WIB";

      const avatarBase64 = await getAvatarDataUri(telegram, target.id, chatInfo);

      const card = await renderMemberIdCard({
        eyebrow: "• IDENTITAS • PROFIL MEMBER",
        title: "ID TELEGRAM",
        name: fullName,
        avatarBase64,
        fields: [
          { label: "ID Pengguna", value: String(target.id) },
          { label: "Tipe Akun", value: accountType },
          { label: "Username", value: username },
          { label: "Premium", value: premium },
          { label: "Nama Akun", value: fullName },
          { label: "Bahasa", value: language },
        ],
        pillText: "CARD USER INFO • PROFILE CARD",
        footerLeft: `${config.botName || "AzmiStecu-MD"}`.toUpperCase(),
        footerRight: now,
        theme: "crimson",
      });

      const rows = [
        ["ID Pengguna", String(target.id)],
        ["Username", username],
        ["Nama Akun", fullName],
        ["Premium", premium],
      ];

      const copyButton = (extra = {}) => ({
        inline_keyboard: [[{ text: "Copy ID", copy_text: { text: String(target.id).slice(0, 256) }, ...extra }]],
      });
      // Tombol Copy ID merah (style "danger") -> kalau ditolak server, coba tanpa style -> tanpa tombol.
      const markups = [copyButton({ style: "danger" }), copyButton(), undefined];

      // ── Jalur utama: Rich Message penuh (foto kartu + judul + tabel + catatan dalam SATU pesan) ──
      // Foto di-upload dulu hanya untuk dapat file_id (pesan penampung langsung dihapus).
      const fileId = await uploadForFileId(ctx, "photo", { source: card });
      if (fileId) {
        for (const markup of markups) {
          try {
            await telegram.callApi("sendRichMessage", {
              chat_id: ctx.chat.id,
              rich_message: {
                html: infoRich(rows, now),
                media: [{ id: "idcard", media: { type: "photo", media: fileId } }],
              },
              ...(markup ? { reply_markup: markup } : {}),
              ...(ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
              ...replyTo,
            });
            return;
          } catch (e) {
            console.warn("[ID] Rich Message gagal:", e.message);
            if (/not found|unknown method/i.test(e?.message || "")) break; // server belum support rich
          }
        }
      }

      // ── Fallback: foto + caption HTML biasa (kalau server belum support Rich Message) ──
      const caption = buildCard({
        title: "🔔 INFO USER",
        headers: ["Field", "Detail"],
        rows,
        note: `🕒 Diambil: ${now}`,
      });
      const base = { caption, parse_mode: "HTML", ...replyTo };
      let lastErr;
      for (const markup of markups) {
        try {
          await ctx.replyWithPhoto({ source: card }, markup ? { ...base, reply_markup: markup } : base);
          return;
        } catch (e) {
          lastErr = e;
          if (!/button|copy_text|style|reply_markup|can't parse/i.test(e?.message || "")) break;
        }
      }
      throw lastErr;
    } catch (err) {
      console.error("[ID] Gagal:", err.message);
      await sendRich(
        telegram,
        ctx.chat.id,
        noticeView("⚠️ Gagal", `Gagal ambil/kirim kartu info user.<br>ID: <code>${target.id}</code>`),
        replyTo
      ).catch(() => {});
    }
  },
};

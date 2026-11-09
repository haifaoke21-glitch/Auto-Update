import { allOwnerIds, isOwner } from "../../src/middleware.js";
import { usersDb, getUser } from "../../src/database.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, sendRich, editRich, simpleView, richTable } from "../../src/lib/rich.js";
import config from "../../config.js";
import { startChat, endChat, promptView, chatKeyboard, openChatWithNewMessage } from "../../src/lib/ownerChat.js";

// /owner — info owner + tombol Chat Owner (via bot / langsung ke profil) + Batal.
// Tampilan Rich Message (judul + tabel); otomatis fallback ke HTML biasa.

const MAX_SHOWN = 5;
const infoCache = new Map(); // ownerId -> { at, name, username }
const CACHE_MS = 10 * 60 * 1000;

async function ownerInfo(telegram, id) {
  const hit = infoCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  let name = usersDb.data.users[id]?.name || "";
  let username = usersDb.data.users[id]?.username || "";
  try {
    const c = await telegram.getChat(id); // berhasil kalau owner pernah memulai bot
    name = [c.first_name, c.last_name].filter(Boolean).join(" ") || name;
    username = c.username || username;
  } catch { /* pakai data database */ }
  const info = { id, at: Date.now(), name: name || "-", username };
  infoCache.set(id, info);
  return info;
}

// Tombol profil hanya untuk owner yang punya username: URL tg://user?id= ditolak Telegram
// (BUTTON_USER_PRIVACY_RESTRICTED) kalau owner belum pernah chat dengan bot / privasinya tertutup.
const profileUrl = (o) => `https://t.me/${o.username}`;
const validUsername = (u) => /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(String(u || ""));

function buildView(owners) {
  const rows = owners.map((o, i) => [
    String(i + 1),
    h(o.name),
    o.username ? `@${h(o.username)}` : "-",
    `<code>${o.id}</code>`,
  ]);
  const legacyRows = owners
    .map((o, i) => `${i + 1}. ${h(o.name)} | ${o.username ? "@" + h(o.username) : "-"} | <code>${o.id}</code>`)
    .join("\n");
  return {
    rich:
      `<h1><tg-emoji emoji-id="5217822164362739968">👑</tg-emoji> Owner ${h(config.botName)}</h1>` +
      `<p>Hubungi owner untuk kerja sama atau pertanyaan seputar layanan.</p>` +
      richTable(["No", "Nama", "Username", "User ID"], rows) +
      `<blockquote><tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> <b>Via Bot</b> — pesanmu diteruskan lewat bot ini, balasan datang ke sini.<br>` +
      `<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> <b>Profil</b> — langsung membuka chat pribadi dengan owner.</blockquote>`,
    legacy:
      `<b><tg-emoji emoji-id="5217822164362739968">👑</tg-emoji> Owner ${h(config.botName)}</b>\n\nHubungi owner untuk kerja sama atau pertanyaan seputar layanan.\n\n${legacyRows}\n\n` +
      `<tg-emoji emoji-id="5443038326535759644">💬</tg-emoji> Via Bot: pesan diteruskan lewat bot ini.\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Profil: langsung ke chat pribadi owner.`,
  };
}

function buildKeyboard(owners, uid, botUsername, isPrivate, { style = true, profile = true } = {}) {
  const viaBot = isPrivate || !botUsername
    ? { text: "Chat Owner via Bot", icon_custom_emoji_id: "5443038326535759644", emoji_fallback: "💬", callback_data: `owner:bot:${uid}`, ...(style ? { style: "primary" } : {}) }
    : { text: "Chat Owner via Bot (buka PM)", icon_custom_emoji_id: "5443038326535759644", emoji_fallback: "💬", url: `https://t.me/${botUsername}?start=owner` };
  const profileBtns = !profile ? [] : owners.filter((o) => validUsername(o.username)).map((o) => ({
    text: owners.length > 1 ? `👤 Profil ${o.name !== "-" ? o.name : o.id}`.slice(0, 40) : "👤 Chat Owner (Profil)",
    url: profileUrl(o),
  }));
  return {
    inline_keyboard: [[viaBot], ...profileBtns.map((b) => [b]), [{ text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `owner:cancel:${uid}`, ...(style ? { style: "danger" } : {}) }]],
  };
}

// ───────────────────────── Callback ─────────────────────────
registerCallback("owner", async (ctx, args) => {
  const [action, targetUid] = args;
  const uid = String(ctx.from.id);
  const msg = ctx.callbackQuery.message;

  // Tombol hanya untuk orang yang membukanya (di grup, orang lain tidak boleh menutup / memakai)
  if (targetUid && targetUid !== uid && !isOwner(uid)) {
    return ctx.answerCbQuery("Tombol ini bukan untukmu. Ketik /owner sendiri.", { show_alert: true });
  }

  if (action === "cancel") {
    await editRich(ctx.telegram, msg.chat.id, msg.message_id, simpleView("❌ Dibatalkan."));
    return ctx.answerCbQuery();
  }

  if (action === "end") {
    endChat(uid);
    await editRich(ctx.telegram, msg.chat.id, msg.message_id, simpleView("✅ Chat dengan owner selesai. Ketik /owner kalau mau menghubungi lagi."));
    return ctx.answerCbQuery();
  }

  if (action === "bot" || action === "reply") {
    if (msg.chat.type !== "private") {
      return ctx.answerCbQuery("Buka chat pribadi dengan bot lalu ketik /owner.", { show_alert: true });
    }
    if (isOwner(uid)) return ctx.answerCbQuery("Kamu adalah owner bot.", { show_alert: true });
    if (getUser(uid).banned) return ctx.answerCbQuery("Kamu tidak bisa memakai fitur ini.", { show_alert: true });

    if (action === "reply") {
      // dari balasan owner: kirim prompt sebagai pesan baru supaya balasan owner tidak tertimpa
      await openChatWithNewMessage(ctx.telegram, uid);
      return ctx.answerCbQuery("Ketik balasanmu sekarang.");
    }
    startChat(uid, msg.chat.id, msg.message_id);
    await editRich(ctx.telegram, msg.chat.id, msg.message_id, promptView(), chatKeyboard(uid, "Batal"));
    return ctx.answerCbQuery("Ketik pesanmu sekarang.");
  }

  return ctx.answerCbQuery();
});

// ───────────────────────── Command ─────────────────────────
export default {
  command: ["owner"],
  category: "main",
  description: "Info owner + tombol chat owner (via bot / profil)",
  loading: false,
  run: async (ctx) => {
    const ids = allOwnerIds().slice(0, MAX_SHOWN);
    if (!ids.length) return ctx.reply("Owner belum diset di config.js.");

    const owners = await Promise.all(ids.map((id) => ownerInfo(ctx.telegram, id)));
    const botUsername = ctx.botInfo?.username || (await ctx.telegram.getMe()).username;
    const isPrivate = ctx.chat.type === "private";

    const extra = {
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      ...(ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
    };
    // Tangga percobaan: tombol lengkap -> tanpa warna -> tanpa tombol profil. Tombol "Chat Owner via Bot" selalu dipertahankan.
    const tries = [{}, { style: false }, { style: false, profile: false }];
    let lastErr;
    for (const opt of tries) {
      try {
        await sendRich(ctx.telegram, ctx.chat.id, buildView(owners), { reply_markup: buildKeyboard(owners, ctx.from.id, botUsername, isPrivate, opt), ...extra });
        return;
      } catch (e) {
        lastErr = e;
        console.error(`[OWNER] kirim gagal (${JSON.stringify(opt)}):`, e.message);
      }
    }
    throw lastErr;
  },
};

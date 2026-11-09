// ═══════════════════════════════════════════════════════════════════════
// ANTI BOT — keluarkan bot lain yang ditambahkan ke grup oleh member biasa.
//
// Aktif per grup lewat /antibot on | off | status (plugins/group/antibot.js).
// Alur: ada new_chat_members berisi bot (selain bot ini) -> cek siapa yang menambahkan:
//   • admin grup / admin anonim / owner bot  -> dibiarkan (sengaja menambah bot)
//   • member biasa                           -> bot dikeluarkan (ban + unban, jadi admin masih bisa
//                                               menambahkannya lagi), pesan "X bergabung" dihapus,
//                                               lalu bot memberi pemberitahuan yang hilang sendiri.
// Bot butuh jadi admin dengan izin "Blokir pengguna" (dan "Hapus pesan" supaya pesan join ikut hilang).
// Dipasang di botSetup.js SEBELUM newMemberHandler; selalu lanjut ke handler berikutnya (welcome tetap jalan).
// ═══════════════════════════════════════════════════════════════════════
import { getGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { isAdminFast } from "./adminCache.js";
import { botInfo, esc, mention, fullName } from "./groupUtil.js";
import { sendView, note, quote } from "./richUi.js";
import { E } from "./emo.js";

const ANON_ADMIN_BOT = 1087968824; // akun "GroupAnonymousBot" (admin yang mengirim sebagai anonim)
const NOTICE_TTL = 8000; // pemberitahuan dihapus otomatis setelah 8 detik

const warnedNoPerm = new Set(); // grup yang sudah diberi tahu "bot belum admin" (cukup sekali)

const botLabel = (b) => (b.username ? `@${esc(b.username)}` : `<b>${esc(b.first_name || "Bot")}</b>`);

function autoDelete(ctx, sent, ms = NOTICE_TTL) {
  if (!sent) return;
  const t = setTimeout(() => ctx.telegram.deleteMessage(sent.chat.id, sent.message_id).catch(() => {}), ms);
  t.unref?.();
}

/** Kirim Rich Message ke grup (cadangan HTML otomatis); null kalau gagal */
const send = (ctx, rich) => {
  const thread = ctx.message?.message_thread_id;
  return sendView(ctx.telegram, ctx.chat.id, rich, undefined, thread ? { message_thread_id: thread } : {}).catch(() => null);
};

/** Middleware untuk event new_chat_members */
export async function antiBotHandler(ctx, next) {
  const chat = ctx.chat;
  const msg = ctx.message;
  if (!chat || !msg?.new_chat_members?.length || (chat.type !== "group" && chat.type !== "supergroup")) return next();
  if (!getGroup(chat.id).antibot) return next();

  let me;
  try {
    me = await botInfo(ctx);
  } catch {
    return next();
  }
  const bots = msg.new_chat_members.filter((m) => m.is_bot && m.id !== me.id);
  if (!bots.length) return next();

  // Yang menambahkan: owner bot / admin grup / admin anonim boleh menambah bot
  const adder = ctx.from;
  const anon = msg.sender_chat?.id === chat.id || adder?.id === ANON_ADMIN_BOT;
  if (anon || (adder && (isOwner(adder.id) || (await isAdminFast(ctx))))) return next();

  // Keluarkan tiap bot: ban lalu unban supaya tidak terblokir permanen (admin tetap bisa menambahkannya lagi)
  const removed = [];
  let lastErr = null;
  for (const b of bots) {
    try {
      await ctx.telegram.banChatMember(chat.id, b.id);
      await ctx.telegram.unbanChatMember(chat.id, b.id, { only_if_banned: true }).catch(() => {});
      removed.push(b);
    } catch (err) {
      lastErr = err;
      console.warn(`[ANTIBOT] Gagal mengeluarkan bot ${b.id} dari ${chat.id}: ${err.description || err.message}`);
    }
  }

  if (!removed.length) {
    // Tidak ada yang berhasil dikeluarkan -> kemungkinan bot ini belum admin; beri tahu sekali per grup
    if (lastErr && !warnedNoPerm.has(chat.id)) {
      warnedNoPerm.add(chat.id);
      await send(ctx, note(E.warn, "Anti Bot belum bisa bekerja", "Aku belum bisa mengeluarkan bot.") + quote("Jadikan aku admin dengan izin <b>Blokir pengguna</b> (dan <b>Hapus pesan</b>)."));
    }
    return next();
  }

  // Hapus pesan "… menambahkan bot" (butuh izin hapus pesan; kalau tidak ada, abaikan)
  if (removed.length === msg.new_chat_members.length) ctx.telegram.deleteMessage(chat.id, msg.message_id).catch(() => {});

  const who = adder ? mention(adder.id, fullName(adder)) : "Seseorang";
  // ID bot disembunyikan di spoiler (ketuk untuk membuka)
  const list = removed.map((b) => `${botLabel(b)} (<tg-spoiler><code>${b.id}</code></tg-spoiler>)`).join("<br>");
  const sent = await send(
    ctx,
    note(E.deny, "Bot dikeluarkan", `${E.bot} ${list}`) +
      quote(`${who}, hanya <b>admin</b> yang boleh menambahkan bot di grup ini.`, "<i>Anti Bot aktif. Pesan ini hilang otomatis.</i>")
  );
  autoDelete(ctx, sent);

  return next();
}

import { messageHandler, newMemberHandler, leftMemberHandler, antiLinkHandler } from "../handler.js";
import { joinRequestHandler } from "./getlink.js";
import { memberTrackerHandler, chatMemberTrackerHandler, reactionTrackerHandler } from "./memberTracker.js";
import { autoReactHandler } from "./autoReact.js";
import { groupGuardHandler } from "./groupGuard.js";
import { antiFloodHandler } from "./antiFlood.js";
import { antiAdminHandler } from "./antiAdmin.js";
import { antiSpamHandler } from "./antiSpam.js";
import { fsubHandler, fsubTrackChat, fsubChannelWatch } from "./fsub.js";
import { filterHandler } from "./filterHandler.js";
import { antiBotHandler } from "./antiBot.js";
import { warmAdmins, adminCacheWatch } from "./adminCache.js";
import { gameAnswerHandler } from "./games.js";
import { pendingInputHandler } from "./satriam.js";
import { installPanelTextHandler } from "./installPanel.js";
import { callbackHandler } from "./callbacks.js";
import { cfdChatMemberHandler, cfdChannelPostHandler } from "./cfd.js";
import { ownerChatHandler } from "./ownerChat.js";
import { jadibotTextHandler } from "./jadibot.js";
import { cpanelHubTextHandler } from "./cpanel/hub.js";
import { buildFileHandler, buildTextHandler } from "./buildmenu/index.js";
import { installPremiumEmoji } from "./premiumEmoji.js";
import { installRichReply } from "./richReply.js";
import { transformRichMessage, stripRichMessage } from "./richEmoji.js";
import { trackOwnerPremium, isMainOrCloneOwner } from "./ownerPremium.js";
import config from "../../config.js";
import { donateProofHandler, donateDocHandler, donateTextHandler } from "./donate.js";

/** Pasang semua handler ke sebuah instance Telegraf. Dipakai bot utama dan bot clone (Jadi Bot). */
export function registerHandlers(bot, { isClone = false, ownerId = null } = {}) {
  // Pemilik bot: bot utama = config.ownerIds, bot clone = pembuat clone.
  // Emoji premium di bot clone: SELALU dikirim sebagai TG emoji (alwaysPremium), tidak perlu menunggu
  // pemilik bot /start atau terdeteksi premium. Bila tidak bisa ditampilkan, Telegram memakai emoji biasa.
  const mainOwnerIds = () => (config.ownerIds || []).map(String);
  const ownerIds = isClone
    ? () => mainOwnerIds()   // clone hanya ikuti pemilik bot utama
    : mainOwnerIds;
  // Emoji premium otomatis untuk SEMUA pesan, caption, Rich Message & tombol (lihat lib/premiumEmoji.js).
  // Kalau pemilik bot tidak premium, semuanya otomatis dikirim sebagai emoji biasa.
  installPremiumEmoji(bot, { transformRichMessage, stripRichMessage }, { ownerIds, alwaysPremium: isClone });
  // Catat status premium pemilik dari update-nya (lib/ownerPremium.js)
  bot.use(trackOwnerPremium(isClone ? (id) => ownerIds().includes(id) : isMainOrCloneOwner(ownerIds)));
  // Semua balasan teks fitur otomatis jadi Rich Message (judul, tabel, kartu), fallback ke teks biasa bila ditolak (lib/richReply.js).
  // Harus SETELAH installPremiumEmoji supaya emoji di Rich Message ikut jadi emoji premium.
  installRichReply(bot);

  // PENTING: Telegraf menunggu (await) seluruh rangkaian handler sebelum mengambil update berikutnya, dan
  // menembakkan "TimeoutError: Promise timed out after 90000 milliseconds" bila handler > handlerTimeout.
  // Perintah yang lama (download, AI, SSH install panel, buat server, dll) jadi memblokir SEMUA update
  // lalu error. Solusi: jalankan rangkaian handler di latar belakang supaya polling tidak tertahan.
  bot.use((ctx, next) => {
    const started = Date.now();
    const slow = setTimeout(() => console.warn(`[SLOW] ${ctx.updateType} belum selesai setelah 120 detik (update ${ctx.update?.update_id})`), 120_000);
    slow.unref?.();
    Promise.resolve()
      .then(() => next())
      .catch((err) => {
        try { bot.handleError(err, ctx); } catch (e) { console.error(`[BOT ERROR] ${ctx.updateType}:`, e); }
      })
      .finally(() => clearTimeout(slow));
    return undefined; // langsung selesai -> polling lanjut ke update berikutnya
  });

  // Urutan penting: filter grup (anti promosi/forward, semua jenis pesan) dan antilink dulu (bisa hapus pesan), baru command handler
  // ANTI DELAY: warm cache admin + semua satpam (hapus/mute) dijalankan PALING DEPAN, sebelum tracker, auto react,
  // Force Subscribe (yang memanggil API Telegram) & handler lain, supaya pelanggaran langsung hilang tanpa menunggu.
  bot.on("chat_member", adminCacheWatch);
  bot.on("message", warmAdmins);
  bot.on("message", groupGuardHandler);
  bot.on("message", antiAdminHandler); // Anti Admin: hapus pesan member yang menandai admin (/antiadmin)
  bot.on("message", antiSpamHandler); // Anti Spam: pesan sama berulang, mention berlebihan (/antispam)
  bot.on("message", antiFloodHandler); // Anti Flood: batasi member yang spam pesan (/antiflood)
  bot.on("text", antiLinkHandler); // Anti Link: hapus link undangan grup/channel
  bot.on("message", memberTrackerHandler); // catat member aktif untuk /tagall
  bot.on("chat_member", fsubChannelWatch); // Force Subscribe: user keluar dari channel wajib -> batalkan cache join seketika
  bot.on("chat_member", chatMemberTrackerHandler); // join/leave tanpa chat (bot harus admin)
  bot.on("message_reaction", reactionTrackerHandler);
  bot.on("chat_join_request", joinRequestHandler); // /getlink: setujui hanya orang yang dituju, tolak lainnya
  bot.on("message", autoReactHandler); // auto react (owner: /autoreact on|off)
  bot.on("message", fsubHandler); // Force Subscribe per grup (/fsub, /setfsub): tahan pesan member yang belum join channel wajib
  bot.on("edited_message", groupGuardHandler);
  if (!isClone) bot.on("message", ownerChatHandler); // chat owner via bot (user <-> owner), hanya chat pribadi
  if (!isClone) {
    // Donasi: bukti transfer (foto) & nominal (teks) setelah /donate; harus SEBELUM messageHandler (lib/donate.js)
    bot.on("photo", donateProofHandler);
    bot.on("document", donateDocHandler);
    bot.on("text", donateTextHandler);
  }
  bot.on("message", filterHandler); // balasan otomatis /filter
  if (!isClone) {
    // Build Menu (Build APK & Rename): ZIP project / gambar icon / teks setelah memilih fitur di /start -> Build Menu (chat pribadi). Sebelum messageHandler.
    bot.on("document", buildFileHandler);
    bot.on("photo", buildFileHandler);
    bot.on("text", buildTextHandler);
  }
  bot.on("text", installPanelTextHandler); // wizard Install Panel (IP -> password -> port -> domain), hanya chat pribadi
  bot.on("text", jadibotTextHandler); // token bot untuk fitur Jadi Bot (hanya chat pribadi)
  bot.on("text", cpanelHubTextHandler); // nama panel setelah memilih ukuran di menu CPanel (tidak aktif di bot clone)
  bot.on("text", messageHandler);
  bot.on("text", pendingInputHandler); // paste magic link (camprem)
  bot.on("text", gameAnswerHandler); // jawaban game (pesan non-command)
  bot.on("callback_query", callbackHandler);
  bot.on("my_chat_member", fsubTrackChat); // catat channel/grup tempat bot jadi admin (untuk /setfsub dengan link privat)
  if (!isClone) bot.on("my_chat_member", cfdChatMemberHandler); // catat grup/channel/blokir untuk target /cfd
  if (!isClone) bot.on("channel_post", cfdChannelPostHandler); // catat channel tempat bot jadi admin
  bot.on("photo", messageHandler); // dukung command via caption foto
  bot.on("video", messageHandler);
  bot.on("document", messageHandler);

  bot.on("new_chat_members", antiBotHandler); // Anti Bot: keluarkan bot yang ditambahkan member biasa (sebelum welcome)
  bot.on("new_chat_members", newMemberHandler);
  bot.on("left_chat_member", leftMemberHandler);

}

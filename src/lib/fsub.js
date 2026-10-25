// ═══════════════════════════════════════════════════════════════════════
// FORCE SUBSCRIBE PER GRUP — wajib join channel sebelum boleh chat di grup.
//
// Beda dengan lib/forceJoin.js (wajib join channel untuk memakai BOT, diatur owner di config.js),
// fitur ini dipakai admin tiap grup dan pengaturannya terpisah per grup (group.fsub):
//
//   {
//     on: false,
//     mode: "strict",                     // once | strict | soft
//     channels: { "1": { id, title, username, link }, "2": {...}, ... },  // slot 1..MAX_SLOTS
//     verified: { [userId]: waktu },      // member yang pernah lolos verifikasi
//     muted:    { [userId]: waktu },      // member yang dimute oleh fitur ini (mode strict)
//   }
//
// Mode:
//   once   = verifikasi sekali saja. Sebelum lolos pesan dihapus + diminta join; setelah lolos tidak dicek lagi.
//   strict = wajib subscribe terus. Belum join / keluar channel -> pesan dihapus & member DIBISUKAN (mute)
//            sampai menekan "Saya Sudah Join" dan terbukti sudah join.
//   soft   = pesan member yang belum join dihapus, tanpa mute.
//
// Syarat: bot admin di grup (izin Hapus pesan; mode strict juga Blokir pengguna) dan admin di setiap channel wajib
// (supaya getChatMember bisa dipakai). Admin grup & owner bot selalu dikecualikan.
// Channel yang gagal dicek (bot dikeluarkan dari channel, dll) DILEWATI (fail-open) supaya salah setting tidak
// membisukan semua member; lihat penyebabnya lewat /checkfsub.
// ═══════════════════════════════════════════════════════════════════════
import { getGroup, saveGroup, fsubChatsDb } from "../database.js";
import { isOwner } from "../middleware.js";
import { registerCallback } from "./callbacks.js";
import { MUTE_PERMS, esc, wf, cut, mention, fullName, botInfo, richSay, card } from "./groupUtil.js";
import { editCbView, sendView, note, quote, title, table } from "./richUi.js";
import { E } from "./emo.js";

export const MAX_SLOTS = 5;
export const MODES = {
  once: { label: "Once", desc: "Verifikasi sekali saja. Setelah lolos, member tidak dicek lagi." },
  strict: { label: "Strict", desc: "Wajib subscribe terus. Keluar dari channel = dibisukan (mute) sampai join lagi." },
  soft: { label: "Soft", desc: "Pesan member yang belum join dihapus, tanpa mute." },
};

const TELEGRAM_SERVICE = 777000;
const JOINED = new Set(["creator", "administrator", "member"]);
const JOIN_CACHE_TTL = 15 * 1000; // hasil "sudah join" disimpan 15 detik (hemat API). Keluar channel juga membatalkan cache lewat update chat_member (fsubChannelWatch)
const ADMIN_CACHE_TTL = 5 * 60 * 1000; // daftar admin grup disimpan 5 menit (/reload untuk refresh)
const PROMPT_GAP = 8 * 1000; // jeda minimal antar tindakan/peringatan untuk user yang sama
const PROMPT_TTL = 5 * 60 * 1000; // peringatan mode once/soft dihapus otomatis (strict dibiarkan sampai user verifikasi)
const CONTENT_KEYS = ["text", "photo", "video", "document", "sticker", "voice", "audio", "animation", "video_note", "poll", "contact", "location", "venue", "dice", "game"];

const joinedCache = new Map(); // "chat:user:channel" -> waktu kedaluwarsa
const adminCache = new Map(); // chatId -> { ids:Set, at }
const chanErr = new Map(); // channelId -> { msg, at }  (error terakhir saat mengecek channel)
const prompts = new Map(); // "chat:user" -> message_id peringatan terakhir
const lastAct = new Map(); // "chat:user" -> waktu tindakan terakhir
const warnedPerm = new Map(); // chatId -> waktu peringatan "bot belum punya izin" (diulang tiap 10 menit bila masih bermasalah)
const WARN_PERM_GAP = 10 * 60 * 1000;
const promptLock = new Set(); // "chat:user" yang peringatannya sedang dikirim (cegah peringatan dobel saat album/spam)
const warnedChan = new Set(); // channel yang gagal dicek (log sekali)

const trim = (map, max = 3000) => {
  if (map.size > max) map.delete(map.keys().next().value);
};
const errText = (e) => String(e?.description || e?.message || e).replace(/^\d+:\s*/, "").replace(/^Bad Request:\s*/i, "");

/** Panggil API Telegram dengan retry otomatis untuk 429 (retry_after) & gangguan jaringan sesaat */
async function tgRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const wait = Number(err?.parameters?.retry_after) || (String(err?.code || err?.errno || err?.type || "").match(/ETIMEDOUT|ECONNRESET|EAI_AGAIN|system/) ? 1 : 0);
      if (!wait || i >= tries) throw err;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
    }
  }
}

// ───────────────────────── Config ─────────────────────────

/** Pengaturan fsub sebuah grup, dengan nilai bawaan terisi */
export function fsubCfg(group) {
  const f = group?.fsub || {};
  return {
    on: Boolean(f.on),
    mode: MODES[f.mode] ? f.mode : "strict",
    channels: { ...(f.channels || {}) },
    verified: { ...(f.verified || {}) },
    muted: { ...(f.muted || {}) },
  };
}
export const getFsub = (chatId) => fsubCfg(getGroup(chatId));

/** Ubah pengaturan fsub: patch berupa fungsi yang memodifikasi salinan cfg. Mengembalikan cfg baru. */
export async function patchFsub(chatId, fn) {
  const cfg = getFsub(chatId);
  fn(cfg);
  await saveGroup(chatId, { fsub: cfg });
  return cfg;
}

/** [[slot, channel], ...] terurut berdasarkan slot */
export const activeChannels = (cfg) =>
  Object.entries(cfg.channels || {})
    .filter(([, c]) => c && c.id)
    .sort((a, b) => Number(a[0]) - Number(b[0]));

export function clearChatCache(chatId) {
  const p = `${chatId}:`;
  for (const k of [...joinedCache.keys()]) if (k.startsWith(p)) joinedCache.delete(k);
  adminCache.delete(chatId);
}

const chanLabel = (c) => `<b>${esc(c.title || c.username || c.id)}</b>${c.username ? ` (@${esc(c.username)})` : ""}`;

// ───────────────────────── Resolve channel (untuk /setfsub) ─────────────────────────

/** Ambil kode undangan dari link privat: t.me/+abc | t.me/joinchat/abc -> "abc" */
const inviteHash = (v) => (String(v || "").match(/t(?:elegram)?\.me\/(?:\+|joinchat\/)([\w-]+)/i) || [])[1] || null;

/** "@nama" | "https://t.me/nama" | "-1001234567890" | link undangan privat -> { target } | { invite, link } | { error } */
export function parseChannelInput(raw) {
  const v = String(raw || "").trim();
  if (!v) return { error: "Channel belum diisi." };
  if (/^-100\d{5,}$/.test(v)) return { target: v };
  const hash = inviteHash(v);
  if (hash) return { invite: hash, link: v };
  const name = v.replace(/^https?:\/\/(?:t|telegram)\.me\//i, "").replace(/^@/, "").split(/[/?]/)[0];
  if (!/^[a-zA-Z][\w]{4,}$/.test(name)) return { error: "Format channel tidak dikenal. Pakai <code>@username</code>, link <code>t.me/…</code> (publik maupun privat), atau ID <code>-100…</code>." };
  return { target: "@" + name };
}

/** Catat channel/grup tempat bot jadi admin, supaya link undangan privat bisa dicocokkan ke ID-nya */
export async function fsubTrackChat(ctx, next) {
  try {
    const u = ctx.myChatMember;
    if (u && ["channel", "supergroup", "group"].includes(u.chat.type)) {
      const id = String(u.chat.id);
      const admin = ["administrator", "creator"].includes(u.new_chat_member?.status);
      if (admin) fsubChatsDb.data.chats[id] = { id, title: u.chat.title || id, username: u.chat.username || null };
      else delete fsubChatsDb.data.chats[id];
      await fsubChatsDb.write();
    }
  } catch (err) {
    console.error("[FSUB] catat chat:", err.message);
  }
  return next?.();
}

/** Cari ID chat dari link undangan privat: cocokkan dengan invite_link utama chat yang tercatat (bot admin di sana) */
async function findChatByInvite(telegram, hash) {
  for (const id of Object.keys(fsubChatsDb.data.chats || {})) {
    try {
      const chat = await telegram.getChat(id);
      if (inviteHash(chat.invite_link) === hash) return chat.id;
    } catch {
      /* bot sudah keluar / tidak punya akses: lewati */
    }
  }
  return null;
}

/** Validasi channel lewat Telegram & pastikan bot admin di sana. Mengembalikan { channel } atau { error } */
export async function resolveChannel(telegram, target, customLink, botId) {
  let chat;
  try {
    chat = await telegram.getChat(target);
  } catch (err) {
    return { error: `Channel <code>${esc(target)}</code> tidak ditemukan atau bot belum ada di sana (${esc(errText(err))}).` };
  }
  if (!["channel", "supergroup", "group"].includes(chat.type)) return { error: "Target harus berupa channel atau grup." };
  try {
    const me = await telegram.getChatMember(chat.id, botId);
    if (!["administrator", "creator"].includes(me.status)) throw new Error("bukan admin");
  } catch {
    return { error: `Bot belum jadi <b>admin</b> di <b>${esc(chat.title || target)}</b>. Jadikan bot admin di channel itu dulu supaya bisa mengecek member.` };
  }
  let link = /^https?:\/\/(?:t|telegram)\.me\//i.test(customLink || "") ? customLink : chat.username ? `https://t.me/${chat.username}` : chat.invite_link || null;
  if (!link) link = await telegram.exportChatInviteLink(chat.id).catch(() => null);
  if (!link) return { error: `<b>${esc(chat.title || target)}</b> adalah channel privat dan bot tidak bisa membuat link undangan. Beri bot izin admin <b>Undang pengguna via link</b>, atau kirim link undangannya saja.` };
  return { channel: { id: chat.id, title: chat.title || String(target), username: chat.username || null, link } };
}

// ───────────────────────── Admin cache ─────────────────────────

/** Set id admin grup (cache 5 menit). null kalau gagal diambil. force=true -> ambil ulang (dipakai /reload) */
export async function getAdminIds(telegram, chatId, force = false) {
  const c = adminCache.get(chatId);
  if (!force && c && Date.now() - c.at < ADMIN_CACHE_TTL) return c.ids;
  try {
    const list = await telegram.getChatAdministrators(chatId);
    const ids = new Set(list.map((a) => a.user.id));
    adminCache.set(chatId, { ids, at: Date.now() });
    trim(adminCache, 500);
    return ids;
  } catch {
    return c?.ids || null;
  }
}
export const adminCacheInfo = (chatId) => adminCache.get(chatId) || null;

/** Cek langsung (tanpa cache) apakah user admin grup */
async function liveIsAdmin(telegram, chatId, userId) {
  try {
    const m = await telegram.getChatMember(chatId, userId);
    const ok = ["creator", "administrator"].includes(m.status);
    if (ok) adminCache.get(chatId)?.ids.add(userId);
    return ok;
  } catch {
    return false;
  }
}

/** Admin grup / owner bot yang menekan tombol */
export async function cbAdmin(ctx) {
  if (isOwner(ctx.from.id)) return true;
  if (!ctx.chat || ctx.chat.type === "private") return false;
  return liveIsAdmin(ctx.telegram, ctx.chat.id, ctx.from.id);
}

// ───────────────────────── Cek keanggotaan ─────────────────────────

/** true = sudah join, false = belum, null = tidak bisa dicek */
async function isJoined(telegram, chatId, userId, ch) {
  const key = `${chatId}:${userId}:${ch.id}`;
  if ((joinedCache.get(key) || 0) > Date.now()) return true;
  try {
    const m = await tgRetry(() => telegram.getChatMember(ch.id, userId));
    const ok = JOINED.has(m.status) || (m.status === "restricted" && m.is_member === true);
    if (ok) {
      joinedCache.set(key, Date.now() + JOIN_CACHE_TTL);
      trim(joinedCache, 8000);
    } else joinedCache.delete(key);
    chanErr.delete(ch.id);
    warnedChan.delete(ch.id);
    return ok;
  } catch (err) {
    const t = errText(err);
    if (/user not found|participant_id_invalid/i.test(t)) return false; // user belum pernah ada di channel
    chanErr.set(ch.id, { msg: t, at: Date.now() });
    if (!warnedChan.has(ch.id)) {
      warnedChan.add(ch.id);
      console.warn(`[FSUB] Tidak bisa mengecek channel ${ch.title || ch.id} (${ch.id}): ${t}. Channel ini dilewati sementara; pastikan bot admin di channel tsb.`);
    }
    return null;
  }
}

/** { missing: [[slot, channel]], unknown: [[slot, channel]] } */
export async function checkUser(telegram, chatId, userId, channels) {
  const res = await Promise.all(channels.map(async ([slot, ch]) => [slot, ch, await isJoined(telegram, chatId, userId, ch)]));
  return {
    missing: res.filter((r) => r[2] === false).map(([s, c]) => [s, c]),
    unknown: res.filter((r) => r[2] === null).map(([s, c]) => [s, c]),
  };
}

// ───────────────────────── Mute / unmute ─────────────────────────

async function muteUser(telegram, chatId, userId) {
  await tgRetry(() => telegram.restrictChatMember(chatId, userId, { permissions: MUTE_PERMS }));
}

/** Kembalikan izin sesuai izin default grup */
async function unmuteUser(telegram, chatId, userId) {
  const chat = await telegram.getChat(chatId);
  const perms = chat.permissions || {
    can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
    can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
    can_send_other_messages: true, can_add_web_page_previews: true,
  };
  await telegram.restrictChatMember(chatId, userId, { permissions: { ...perms, can_send_messages: true } });
}

async function markVerified(chatId, userId) {
  const cfg = getFsub(chatId);
  if (cfg.verified[userId] && !cfg.muted[userId]) return cfg;
  return patchFsub(chatId, (c) => {
    c.verified[userId] = Date.now();
    delete c.muted[userId]; // lolos cek = tidak lagi dalam status mute oleh fsub
  });
}

// ───────────────────────── Peringatan ke member (Rich Message, tombol di dalam badan pesan) ─────────────────────────

const attr = (s) => esc(s).replace(/"/g, "&quot;");
const btnText = (s, n = 32) => cut(s, n).trim() || "Channel";

/** Baris tombol di DALAM badan Rich Message (Bot API 10.3: <tg-button-row><tg-button>), semua warna danger (merah) */
function inBodyButtons(rows) {
  return rows
    .map(
      (row) =>
        `<tg-button-row>${row
          .map((b) =>
            b.url
              ? `<tg-button type="url" style="danger" url="${attr(b.url)}">${esc(b.text)}</tg-button>`
              : `<tg-button type="callback_data" style="danger" data="${attr(b.data)}">${esc(b.text)}</tg-button>`
          )
          .join("")}</tg-button-row>`
    )
    .join("");
}

function promptView(chatId, user, missing, cfg, { wasVerified, muted }) {
  const strict = cfg.mode === "strict";
  const head = strict && wasVerified ? `${E.warn} LANGGANAN TERPUTUS` : `${E.deny} WAJIB SUBSCRIBE`;
  const intro =
    strict && wasVerified
      ? `Kamu terdeteksi keluar dari salah satu channel wajib (mode <b>Strict</b> aktif di grup ini). Join lagi ke:`
      : `Hai ${mention(user.id, fullName(user))}, untuk chat di grup ini kamu wajib join channel berikut:`;
  const effect =
    cfg.mode === "strict" ? (muted ? `${E.mute} Kamu dibisukan sampai join dan verifikasi.` : "")
    : cfg.mode === "soft" ? `${E.note} Pesanmu dihapus sampai kamu join.`
    : `${E.note} Verifikasi cukup sekali saja, setelah itu tidak dicek lagi.`;
  const list = missing.map(([, c], i) => `${i + 1}. ${chanLabel(c)}`);
  const hint = `Klik tombol di bawah untuk join,<br>lalu tekan ${E.ok} <b>Saya Sudah Join</b>.`;

  // Tombol: join per channel + verifikasi (semua di dalam badan pesan)
  const btnRows = missing.map(([, c], i) => [{
    text: missing.length > 1 ? btnText(`Channel ${i + 1}: ${cut(c.title || "", 24)}`) : btnText(c.title || "Channel"),
    url: c.link,
  }]);
  btnRows.push([{ text: "✅ Saya Sudah Join", data: `fsub:chk:${chatId}:${user.id}` }]);

  const rich =
    title("", head) +
    `<p>${intro}</p>` +
    `<p>${list.join("<br>")}</p>` +
    (effect ? `<p>${effect}</p>` : "") +
    quote(hint) +
    inBodyButtons(btnRows);

  // Cadangan bila server belum mengenal tombol di dalam Rich Message: HTML biasa + inline keyboard merah
  const legacy = `<b>${head}</b>\n\n${intro}\n\n${list.join("\n")}\n\n${effect ? effect + "\n\n" : ""}<blockquote>${hint.replace(/<br>/g, "\n")}</blockquote>`;
  const legacyMarkup = {
    inline_keyboard: btnRows.map((row) => row.map((b) => ({
      text: btnText(b.text.replace(/^✅\s*/, "")),
      style: "danger",
      ...(b.url
        ? { url: b.url, icon_custom_emoji_id: "5215668805199473901", emoji_fallback: "📢" }
        : { callback_data: b.data, icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "✅" }),
    }))),
  };
  return { rich, legacy, legacyMarkup };
}

const SEND_FATAL = /forbidden|blocked|kicked|chat not found|can't initiate|not enough rights|too many requests|retry after|\b429\b|upgraded to a supergroup/i;

/** Kirim Rich Message (tombol di dalam badan). Gagal -> HTML biasa + inline keyboard. Mengembalikan pesan terkirim. */
async function sendPromptMessage(telegram, chatId, view, extra) {
  try {
    return await telegram.callApi("sendRichMessage", { chat_id: chatId, rich_message: { html: view.rich }, ...extra });
  } catch (err) {
    if (SEND_FATAL.test(errText(err))) throw err;
    console.warn("[FSUB] Rich Message dengan tombol ditolak, pakai pesan biasa:", errText(err));
  }
  return telegram.sendMessage(chatId, view.legacy, {
    parse_mode: "HTML",
    reply_markup: view.legacyMarkup,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

async function sendPrompt(ctx, cfg, missing, flags) {
  const { chat, from, message: msg } = ctx;
  const key = `${chat.id}:${from.id}`;
  const view = promptView(chat.id, from, missing, cfg, flags);
  const old = prompts.get(key);
  if (old) ctx.telegram.deleteMessage(chat.id, old).catch(() => {});
  const sent = await sendPromptMessage(ctx.telegram, chat.id, view, msg?.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}).catch((err) => {
    console.warn("[FSUB] Gagal kirim peringatan:", errText(err));
    return null;
  });
  if (!sent) return;
  prompts.set(key, sent.message_id);
  trim(prompts, 2000);
  // Mode strict: peringatan dibiarkan karena member yang dimute butuh tombolnya untuk verifikasi
  if (cfg.mode !== "strict") {
    const t = setTimeout(() => {
      ctx.telegram.deleteMessage(chat.id, sent.message_id).catch(() => {});
      if (prompts.get(key) === sent.message_id) prompts.delete(key);
    }, PROMPT_TTL);
    t.unref?.();
  }
}

/** Beri tahu admin (sekali per grup) bahwa bot kurang izin — Rich Message */
async function warnPerm(ctx, text) {
  const last = warnedPerm.get(ctx.chat.id) || 0;
  if (Date.now() - last < WARN_PERM_GAP) return;
  warnedPerm.set(ctx.chat.id, Date.now());
  await sendView(
    ctx.telegram,
    ctx.chat.id,
    note(E.warn, "Force Subscribe belum bisa menindak", text) + quote(`${E.info} Cek lengkap dengan <code>/checkfsub</code>.`)
  ).catch(() => {});
}

// ───────────────────────── Pasang channel (dipakai /setfsub & kiriman langsung) ─────────────────────────

const SETUP_TTL = 5 * 60 * 1000; // setelah /setfsub berhasil, admin boleh kirim channel berikutnya langsung selama 5 menit
const setupPending = new Map(); // "chat:user" -> waktu kedaluwarsa
const firstFreeSlot = (cfg) => Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).find((n) => !cfg.channels[n]) || null;

/** Pasang channel ke slot. slot=null -> slot kosong pertama. rest = [username|link|id, linkUndangan?]. true bila berhasil. */
export async function applyChannel(ctx, slot, rest) {
  const cfg = getFsub(ctx.chat.id);
  if (slot === null) {
    slot = firstFreeSlot(cfg);
    if (!slot) {
      await card(ctx, E.no, "Semua slot terpakai", `Hapus salah satu dulu dengan <code>/delfsub &lt;slot&gt;</code>, atau timpa slot: <code>/setfsub 1 @channel</code>.`);
      return false;
    }
  }
  const parsed = parseChannelInput(rest[0]);
  if (parsed.error) { await card(ctx, E.no, "Channel tidak valid", parsed.error); return false; }

  let target = parsed.target;
  let customLink = rest[1];
  if (parsed.invite) {
    target = await findChatByInvite(ctx.telegram, parsed.invite);
    if (!target) {
      await card(ctx, E.no, "Link undangan tidak dikenali", "Jadikan bot <b>admin</b> di channel/grup itu dulu (supaya terdeteksi), lalu kirim ulang linknya. Atau cukup kirim <b>ID</b>-nya (<code>-100…</code>).");
      return false;
    }
    customLink = parsed.link;
  }
  const me = await botInfo(ctx);
  const res = await resolveChannel(ctx.telegram, target, customLink, me.id);
  if (res.error) { await card(ctx, E.no, "Gagal memasang channel", res.error); return false; }

  const dupe = activeChannels(cfg).find(([s, c]) => c.id === res.channel.id && Number(s) !== slot);
  if (dupe) { await card(ctx, E.no, "Channel sudah terpasang", `<b>${esc(res.channel.title)}</b> sudah ada di slot <b>${dupe[0]}</b>.`); return false; }

  const replaced = cfg.channels[slot];
  const c = await patchFsub(ctx.chat.id, (x) => { x.channels[slot] = res.channel; });
  clearChatCache(ctx.chat.id);

  const next = firstFreeSlot(c);
  const key = `${ctx.chat.id}:${ctx.from.id}`;
  if (next) setupPending.set(key, Date.now() + SETUP_TTL); else setupPending.delete(key);
  trim(setupPending, 500);

  const body =
    note(E.ok, `Slot ${slot} terpasang`, `<b>${esc(res.channel.title)}</b>${res.channel.username ? ` (@${esc(res.channel.username)})` : ""}${replaced ? `<br><i>menggantikan ${esc(replaced.title || replaced.id)}</i>` : ""}`) +
    quote(
      c.on ? `${E.on} Force Subscribe aktif · mode <b>${c.mode}</b>` : `${E.info} Nyalakan dengan <code>/fsub on</code>`,
      ...(next ? [`${E.note} Mau tambah lagi? Langsung kirim <b>username / link / ID</b> channel atau grup berikutnya (masuk slot ${next}), tanpa <code>/setfsub</code>. Tekan <b>Selesai</b> kalau sudah.`] : [])
    );
  if (!next) {
    await richSay(ctx, body);
    return true;
  }
  // Tombol Selesai di DALAM badan Rich Message; kalau server menolak, jatuh ke inline keyboard biasa
  const done = { text: "Selesai", icon_custom_emoji_id: "6206185428702206246", emoji_fallback: "✅", data: `fsub:done:${ctx.chat.id}:${ctx.from.id}` };
  try {
    await ctx.telegram.callApi("sendRichMessage", {
      chat_id: ctx.chat.id,
      rich_message: { html: body + inBodyButtons([[done]]) },
      reply_parameters: { message_id: ctx.message?.message_id, allow_sending_without_reply: true },
      ...(ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
    });
  } catch (err) {
    console.warn("[FSUB] Tombol Selesai di dalam Rich Message ditolak, pakai tombol biasa:", errText(err));
    await richSay(ctx, body, [[{ text: "Selesai", icon_custom_emoji_id: "6206185428702206246", emoji_fallback: "✅", callback_data: done.data }]]);
  }
  return true;
}

/** Kiriman biasa (bukan command) dari admin yang baru memasang channel: "@channel", link t.me, atau -100… [link undangan] */
async function handleSetupInput(ctx) {
  const { chat, from, message: msg } = ctx;
  const key = `${chat.id}:${from.id}`;
  const exp = setupPending.get(key);
  if (!exp) return false;
  if (exp < Date.now()) { setupPending.delete(key); return false; }
  const text = String(msg?.text || "").trim();
  if (!text || text.startsWith("/")) return false;
  const parts = text.split(/\s+/);
  const tok = /^(@[A-Za-z]\w{4,}|https?:\/\/(?:t|telegram)\.me\/\S+|-100\d{5,})$/i;
  if (parts.length > 2 || !tok.test(parts[0]) || (parts[1] && !/^https?:\/\/(?:t|telegram)\.me\//i.test(parts[1]))) return false;
  if (!(await cbAdmin(ctx))) return false;
  await applyChannel(ctx, null, parts);
  return true;
}

// ───────────────────────── Middleware pesan grup ─────────────────────────

export async function fsubHandler(ctx, next) {
  try {
    const { chat, message: msg, from } = ctx;
    if (msg && chat && from && !from.is_bot && (chat.type === "group" || chat.type === "supergroup") && setupPending.size && (await handleSetupInput(ctx))) return;
    if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
    if (msg.is_automatic_forward || msg.sender_chat || !from || from.is_bot || from.id === TELEGRAM_SERVICE) return next();
    if (!CONTENT_KEYS.some((k) => msg[k] !== undefined)) return next(); // pesan layanan (join/keluar/pin, dll) dilewati

    const cfg = getFsub(chat.id);
    if (!cfg.on) return next();
    const channels = activeChannels(cfg);
    if (!channels.length) return next();
    if (isOwner(from.id)) return next();
    if (cfg.mode === "once" && cfg.verified[from.id]) return next();

    const admins = await getAdminIds(ctx.telegram, chat.id);
    if (admins?.has(from.id)) return next();

    const { missing } = await checkUser(ctx.telegram, chat.id, from.id, channels);
    if (!missing.length) {
      if (cfg.mode !== "soft") await markVerified(chat.id, from.id);
      return next();
    }

    // Cache admin bisa basi (admin baru): pastikan langsung sebelum menindak
    if (await liveIsAdmin(ctx.telegram, chat.id, from.id)) return next();

    const key = `${chat.id}:${from.id}`;
    const now = Date.now();
    const again = promptLock.has(key) || now - (lastAct.get(key) || 0) < PROMPT_GAP; // album / spam: cukup satu peringatan
    lastAct.set(key, now);
    trim(lastAct);
    if (!again) promptLock.add(key); // kunci SEKARANG (sinkron) supaya pesan paralel tidak ikut kirim peringatan

    try {
      // Hapus pesan & mute dijalankan BERSAMAAN (dulu berurutan => mute telat); keduanya diulang otomatis bila kena 429
      const del = tgRetry(() => ctx.telegram.deleteMessage(chat.id, msg.message_id)).then(() => true, (err) => {
        console.warn(`[FSUB] Gagal hapus pesan di ${chat.id}:`, errText(err));
        return false;
      });
      const mut = cfg.mode === "strict"
        ? muteUser(ctx.telegram, chat.id, from.id).then(() => null, (err) => err)
        : Promise.resolve(null);
      const [deleted, muteErr] = await Promise.all([del, mut]);

      const muted = cfg.mode === "strict" && !muteErr;
      if (muted && !cfg.muted[from.id]) patchFsub(chat.id, (c) => { c.muted[from.id] = Date.now(); }).catch(() => {}); // simpan di latar belakang
      if (muteErr) {
        console.warn(`[FSUB] Gagal mute ${from.id} di ${chat.id}:`, errText(muteErr));
        const why = /can't remove chat owner|administrator|owner/i.test(errText(muteErr)) ? "member itu admin/owner grup"
          : /supergroup|only for/i.test(errText(muteErr)) ? "grup ini masih grup biasa, ubah jadi supergroup"
          : "bot perlu jadi <b>admin</b> dengan izin <b>Blokir pengguna</b>";
        await warnPerm(ctx, `Mode Strict gagal membisukan member: ${why} (${esc(errText(muteErr))}).`);
      }
      if (!deleted) await warnPerm(ctx, "Bot butuh izin <b>Hapus pesan</b> supaya pesan member yang belum join bisa dihapus.");

      if (!again) await sendPrompt(ctx, cfg, missing, { wasVerified: Boolean(cfg.verified[from.id]), muted });
    } finally {
      promptLock.delete(key);
    }
    return; // pesan ditahan: handler lain (command, filter, dll) tidak dijalankan
  } catch (err) {
    console.error("[FSUB] handler error:", err);
    return next();
  }
}

// ───────────────────────── Pantau keluar dari channel wajib (batalkan cache seketika) ─────────────────────────

/** Update chat_member dari channel wajib: user keluar/dikick -> hapus cache "sudah join"-nya, jadi pesan berikutnya langsung kena mute */
export async function fsubChannelWatch(ctx, next) {
  try {
    const u = ctx.update?.chat_member;
    if (u && u.chat && u.new_chat_member?.user) {
      const st = u.new_chat_member.status;
      const left = ["left", "kicked"].includes(st) || (st === "restricted" && u.new_chat_member.is_member === false);
      if (left) {
        const suffix = `:${u.new_chat_member.user.id}:${u.chat.id}`;
        for (const k of [...joinedCache.keys()]) if (k.endsWith(suffix)) joinedCache.delete(k);
      }
    }
  } catch (err) {
    console.error("[FSUB] watch:", err.message);
  }
  return next?.();
}

// ───────────────────────── Tombol "Saya Sudah Join" ─────────────────────────

async function verifyCallback(ctx, args) {
  const chatId = Number(args[1]);
  const uid = Number(args[2]);
  if (!chatId || !uid) return ctx.answerCbQuery();
  if (ctx.from.id !== uid) return ctx.answerCbQuery("Tombol ini bukan untukmu.", { show_alert: true });

  const cfg = getFsub(chatId);
  const channels = activeChannels(cfg);
  const { missing } = await checkUser(ctx.telegram, chatId, uid, channels);
  if (missing.length) {
    return ctx.answerCbQuery(cut(`❌ Kamu belum join: ${missing.map(([, c]) => c.title || c.username).join(", ")}`, 190), { show_alert: true });
  }

  if (cfg.mode !== "soft") await markVerified(chatId, uid);
  let note2 = "";
  if (cfg.muted[uid]) {
    try {
      await unmuteUser(ctx.telegram, chatId, uid);
      await patchFsub(chatId, (c) => { delete c.muted[uid]; });
      note2 = " Kamu sudah bisa chat lagi.";
    } catch (err) {
      note2 = " Tapi bot gagal membuka mute-mu, minta admin pakai /unmute.";
      console.warn("[FSUB] Gagal unmute:", errText(err));
    }
  }
  await ctx.answerCbQuery(`✅ Verifikasi berhasil!${note2}`, { show_alert: Boolean(note2) });
  const m = ctx.callbackQuery?.message;
  if (m) {
    prompts.delete(`${chatId}:${uid}`);
    await ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {});
  }
}

// ───────────────────────── Panel pengaturan (tombol Force Subscribe) ─────────────────────────

async function rightsProblems(telegram, chatId, botId, mode) {
  const out = [];
  try {
    const m = await telegram.getChatMember(chatId, botId);
    if (!["administrator", "creator"].includes(m.status)) return ["bot belum jadi admin grup"];
    if (m.status === "administrator") {
      if (m.can_delete_messages === false) out.push("izin Hapus pesan belum aktif");
      if (mode === "strict" && m.can_restrict_members === false) out.push("izin Blokir pengguna belum aktif (dibutuhkan mode Strict)");
    }
  } catch {
    out.push("gagal membaca status bot di grup");
  }
  return out;
}

export function panelView(chatId) {
  const cfg = getFsub(chatId);
  const chs = activeChannels(cfg);
  const rich =
    title(E.shield, "Force Subscribe") +
    table(["Pengaturan", "Nilai"], [
      [`${E.gear} Status`, cfg.on ? `<b>AKTIF</b> ${E.ok}` : `<b>nonaktif</b> ${E.no}`],
      [`${E.deny} Mode`, `<b>${MODES[cfg.mode].label}</b>`],
      [`${E.list} Channel`, `<b>${chs.length}</b> dari ${MAX_SLOTS} slot`],
      [`${E.user} Terverifikasi`, `<b>${Object.keys(cfg.verified).length}</b> member`],
    ]) +
    (chs.length
      ? table(["Slot", "Channel"], chs.map(([s, c]) => [`<b>${s}</b>`, chanLabel(c)]))
      : note(E.info, "Belum ada channel", "Tambah dengan <code>/setfsub 1 @channel</code>")) +
    quote(
      `${E.note} <b>${MODES[cfg.mode].label}</b>: ${MODES[cfg.mode].desc}`,
      "Ganti mode: <code>/fsub mode once|strict|soft</code>"
    );
  const rows = [
    [{ text: cfg.on ? "🔴 Matikan" : "🟢 Aktifkan", callback_data: "fsub:t" }],
    Object.keys(MODES).map((m) => ({ text: `${cfg.mode === m ? "✅ " : ""}${MODES[m].label}`, callback_data: `fsub:m:${m}` })),
    [
      { text: "♻️ Reload", callback_data: "fsub:reload" },
      { text: "🔎 Diagnostik", callback_data: "fsub:check" },
    ],
    [
      { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", callback_data: "gset:home" },
      { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: "gset:x" },
    ],
  ];
  return { rich, rows };
}

// ───────────────────────── Diagnostik real-time (/checkfsub) ─────────────────────────

const yn = (v) => (v ? `${E.ok} Ya` : `${E.no} Tidak`);
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} detik lalu` : `${Math.round(s / 60)} menit lalu`;
};

/** target = { id, name } (opsional): ikut cek status user itu di tiap channel */
export async function diagnoseHtml(ctx, target = null) {
  const chatId = ctx.chat.id;
  const tg = ctx.telegram;
  const cfg = getFsub(chatId);
  const chs = activeChannels(cfg);
  const me = await botInfo(ctx);
  const problems = [];

  // Status bot di grup
  let botRows;
  try {
    const m = await tg.getChatMember(chatId, me.id);
    const isAdm = ["administrator", "creator"].includes(m.status);
    const full = m.status === "creator";
    const del = isAdm && (full || m.can_delete_messages !== false);
    const res = isAdm && (full || m.can_restrict_members !== false);
    if (!isAdm) problems.push("Bot belum jadi admin grup.");
    else {
      if (!del) problems.push("Bot tidak punya izin Hapus pesan.");
      if (!res && cfg.mode === "strict") problems.push("Mode Strict butuh izin Blokir pengguna.");
    }
    botRows = [
      [`${E.bot} Bot admin grup`, yn(isAdm)],
      ["Izin Hapus pesan", yn(del)],
      ["Izin Blokir pengguna", cfg.mode === "strict" ? yn(res) : `${yn(res)} <i>(tidak wajib)</i>`],
    ];
  } catch (err) {
    problems.push(`Gagal membaca status bot: ${esc(errText(err))}`);
    botRows = [[`${E.bot} Bot di grup`, `${E.no} gagal dibaca`]];
  }

  // Tiap channel (langsung ke Telegram, tanpa cache)
  const chanRows = [];
  for (const [slot, ch] of chs) {
    let info = [];
    try {
      const [chat, mem, count] = await Promise.all([
        tg.getChat(ch.id),
        tg.getChatMember(ch.id, me.id),
        tg.getChatMembersCount(ch.id).catch(() => "?"),
      ]);
      const adm = ["administrator", "creator"].includes(mem.status);
      if (!adm) problems.push(`Bot bukan admin di channel slot ${slot}.`);
      info.push(`${adm ? E.ok : E.no} bot admin`, `${count} member`);
      if ((chat.title || "") !== ch.title) info.push(`<i>nama kini: ${esc(chat.title)}</i>`);
    } catch (err) {
      problems.push(`Channel slot ${slot} tidak bisa diakses: ${esc(errText(err))}`);
      info = [`${E.no} ${esc(errText(err))}`];
    }
    if (target) {
      try {
        const m = await tg.getChatMember(ch.id, target.id);
        const ok = JOINED.has(m.status) || (m.status === "restricted" && m.is_member === true);
        info.push(`${esc(target.name)}: ${ok ? E.ok + " sudah join" : E.no + " belum join"} <i>(${esc(m.status)})</i>`);
      } catch (err) {
        info.push(`${esc(target.name)}: ${E.no} ${esc(errText(err))}`);
      }
    }
    chanRows.push([`<b>${slot}</b>`, `${chanLabel(ch)}<br>${info.join(" · ")}`]);
  }

  if (cfg.on && !chs.length) problems.push("Fsub AKTIF tapi belum ada channel; fitur tidak berjalan.");
  const ac = adminCacheInfo(chatId);
  const joinCached = [...joinedCache.keys()].filter((k) => k.startsWith(`${chatId}:`)).length;

  let html =
    title(E.search, "Diagnostik Force Subscribe") +
    table(["Pengaturan", "Nilai"], [
      [`${E.gear} Status`, cfg.on ? `<b>AKTIF</b> ${E.ok}` : `<b>nonaktif</b> ${E.no}`],
      [`${E.deny} Mode`, `<b>${MODES[cfg.mode].label}</b>`],
      [`${E.list} Channel terpasang`, `<b>${chs.length}</b> / ${MAX_SLOTS}`],
      [`${E.user} Terverifikasi`, `<b>${Object.keys(cfg.verified).length}</b>`],
      [`${E.mute} Dimute oleh fsub`, `<b>${Object.keys(cfg.muted).length}</b>`],
    ]) +
    table(["Bot", "Status"], botRows);
  if (chanRows.length) html += table(["Slot", "Channel"], chanRows);
  html += table(["Cache", "Info"], [
    ["Daftar admin", ac ? `${ac.ids.size} admin · diperbarui ${ago(ac.at)}` : "belum dimuat"],
    ["Hasil \"sudah join\"", `${joinCached} entri (maks 1 menit)`],
  ]);
  html += problems.length
    ? quote(`${E.warn} <b>Masalah ditemukan</b>`, ...problems.map((p) => `• ${p}`))
    : quote(`${E.ok} <b>Semua pemeriksaan lolos.</b> Force Subscribe siap dipakai.`);
  if (target && cfg.verified[target.id]) html += quote(`${E.info} ${esc(target.name)} tercatat <b>terverifikasi</b> ${ago(cfg.verified[target.id])}.`);
  return html;
}

// ───────────────────────── Reload cache ─────────────────────────

/** Refresh cache admin + hasil cek join untuk sebuah grup. Mengembalikan jumlah admin (null = gagal) */
export async function reloadCache(telegram, chatId) {
  clearChatCache(chatId);
  warnedPerm.delete(chatId);
  const ids = await getAdminIds(telegram, chatId, true);
  return ids ? ids.size : null;
}

// ───────────────────────── Callback tombol panel ─────────────────────────

registerCallback("fsub", async (ctx, args) => {
  const act = args[0];
  if (act === "chk") return verifyCallback(ctx, args);
  if (act === "done") {
    const cid = Number(args[1]), uid = Number(args[2]);
    if (ctx.from.id !== uid && !(await cbAdmin(ctx))) return ctx.answerCbQuery("Tombol ini bukan untukmu.", { show_alert: true });
    setupPending.delete(`${cid}:${uid}`);
    await editCbView(ctx, note(E.ok, "Selesai", "Pemasangan channel dihentikan. Cek dengan <code>/listfsub</code>.")).catch(() => {});
    return ctx.answerCbQuery("Selesai");
  }

  if (!ctx.chat || ctx.chat.type === "private") return ctx.answerCbQuery();
  if (!(await cbAdmin(ctx))) return ctx.answerCbQuery("Khusus admin grup.", { show_alert: true });
  const chatId = ctx.chat.id;
  const show = () => {
    const v = panelView(chatId);
    return editCbView(ctx, v.rich, v.rows);
  };

  if (act === "menu") {
    await show();
    return ctx.answerCbQuery();
  }
  if (act === "t") {
    const cfg = getFsub(chatId);
    if (!cfg.on && !activeChannels(cfg).length) return ctx.answerCbQuery("Pasang channel dulu: /setfsub 1 @channel", { show_alert: true });
    const next = await patchFsub(chatId, (c) => { c.on = !c.on; });
    await show();
    if (next.on) {
      const bad = await rightsProblems(ctx.telegram, chatId, (await botInfo(ctx)).id, next.mode);
      if (bad.length) return ctx.answerCbQuery(cut(`Aktif, tapi: ${bad.join("; ")}`, 190), { show_alert: true });
    }
    return ctx.answerCbQuery(next.on ? "Force Subscribe diaktifkan" : "Force Subscribe dimatikan");
  }
  if (act === "m") {
    const mode = args[1];
    if (!MODES[mode]) return ctx.answerCbQuery();
    await patchFsub(chatId, (c) => { c.mode = mode; });
    await show();
    return ctx.answerCbQuery(`Mode: ${MODES[mode].label}`);
  }
  if (act === "reload") {
    const n = await reloadCache(ctx.telegram, chatId);
    await show();
    return ctx.answerCbQuery(n === null ? "Gagal memuat daftar admin" : `Cache dimuat ulang (${n} admin)`);
  }
  if (act === "check") {
    await ctx.answerCbQuery("Memeriksa…");
    const html = await diagnoseHtml(ctx);
    return editCbView(ctx, html, [
      [
        { text: "🔄 Cek Ulang", callback_data: "fsub:check" },
        { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", callback_data: "fsub:menu" },
      ],
    ]);
  }
  return ctx.answerCbQuery();
});

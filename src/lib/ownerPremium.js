// ═══════════════════════════════════════════════════════════════════════
// STATUS TELEGRAM PREMIUM PEMILIK BOT
//
// Emoji premium dari bot hanya tampil kalau PEMILIK bot punya Telegram Premium.
// Bot API tidak punya perintah "cek premium", tapi setiap update dari seorang user membawa
// from.is_premium (true bila premium, kosong bila tidak). Modul ini mencatatnya setiap kali
// pemilik mengirim pesan / menekan tombol, menyimpannya di database/main/settings.json,
// dan memberitahu lib/premiumEmoji.js:
//   • pemilik premium            -> semua emoji dikirim sebagai emoji premium (<tg-emoji>)
//   • pemilik TIDAK premium      -> semua emoji dikirim sebagai emoji biasa
//   • belum pernah terdeteksi    -> dianggap premium (kalau ternyata tidak, Telegram menampilkan emoji biasa)
//
// Pemilik bot utama  = config.ownerIds.
// Pemilik bot clone  = user yang membuat clone lewat Jadi Bot.
// Paksa manual: config.premiumEmojiOwner = true | false (default "auto").
// ═══════════════════════════════════════════════════════════════════════
import { settingsDb, jadibotDb } from "../database.js";
import { setOwnerPremiumProvider, setBotCapabilityStore } from "./premiumEmoji.js";

const KEY = "ownerPremium"; // settings.ownerPremium = { [userId]: true | false }

const store = () => {
  settingsDb.data.settings ||= {};
  return (settingsDb.data.settings[KEY] ||= {});
};

let timer = null;
function saveSoon() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    try { await settingsDb.write(); } catch (e) { console.warn("[PREMIUM] gagal menyimpan status premium:", e.message); }
  }, 2000);
  timer.unref?.();
}

export function recordPremium(userId, isPremium) {
  const s = store();
  const id = String(userId);
  const val = Boolean(isPremium);
  if (s[id] === val) return;
  s[id] = val;
  saveSoon();
  console.log(`[PREMIUM] pemilik ${id} ${val ? "Telegram Premium -> emoji premium aktif" : "bukan Premium -> memakai emoji biasa"}`);
}

setOwnerPremiumProvider((ids) => {
  const s = store();
  // true  = ada owner yang premium (cukup satu)
  // false = SEMUA owner sudah dicek dan tidak ada yang premium
  // null  = masih ada owner yang belum dicek -> belum bisa disimpulkan (emoji premium tetap dicoba)
  let unknown = 0;
  let any = false;
  for (const id of ids) {
    any = true;
    const v = s[String(id)];
    if (v === true) return true;
    if (v !== false) unknown++;
  }
  return any && unknown === 0 ? false : null;
});

/**
 * Middleware Telegraf: catat status premium user yang termasuk pemilik.
 * isTracked(userId) -> boolean menentukan user mana yang dicatat.
 */
export const trackOwnerPremium = (isTracked) => (ctx, next) => {
  try {
    const u = ctx.from;
    if (u && !u.is_bot && isTracked(String(u.id))) recordPremium(u.id, u.is_premium);
  } catch {}
  return next();
};

/** Bot utama: pemilik di config + pemilik bot clone (supaya clone langsung tahu statusnya saat mereka memakai bot utama). */
export const isMainOrCloneOwner = (ownerIds) => (id) => ownerIds().includes(id) || Boolean(jadibotDb.data.bots?.[id]);

/**
 * Cek status Telegram Premium pemilik LANGSUNG saat bot start (tanpa menunggu pemilik mengirim pesan).
 * getChatMember(owner, owner) di chat pribadi mengembalikan objek User lengkap dengan is_premium.
 * Gagal (pemilik belum pernah /start bot) = diabaikan; statusnya tetap dipelajari dari update pemilik nanti.
 */
export async function probeOwnerPremium(telegram, ids) {
  const result = {};
  if (!telegram) return result;
  for (const raw of ids || []) {
    const id = String(raw);
    if (!/^\d+$/.test(id)) continue;
    try {
      const m = await telegram.getChatMember(id, Number(id));
      if (m?.user && !m.user.is_bot) { recordPremium(id, m.user.is_premium); result[id] = Boolean(m.user.is_premium); }
    } catch { /* pemilik belum pernah /start bot */ }
  }
  return result;
}

/**
 * Bot clone (Jadi Bot): bila pembuat clone terbukti Telegram Premium, clone langsung memakai emoji premium
 * sejak pesan pertamanya (tanpa menunggu proses belajar dari hasil kirim). Hanya mengisi bila belum ada catatan,
 * dan hanya untuk "premium" (non-premium / tidak diketahui dipelajari otomatis dari hasil kirim, lihat lib/premiumEmoji.js).
 */
export function seedBotPremium(botId, isPremium) {
  if (!isPremium) return;
  const cur = settingsDb.data.settings?.botPremium?.[String(botId)];
  if (typeof cur === "boolean") return;
  settingsDb.data.settings ||= {};
  (settingsDb.data.settings.botPremium ||= {})[String(botId)] = true;
  saveSoon();
}

// Status premium PEMILIK BOT per bot (dipelajari dari hasil kirim, lihat lib/premiumEmoji.js). settings.botPremium = { [botId]: true | false }
setBotCapabilityStore({
  get: (botId) => settingsDb.data.settings?.botPremium?.[botId],
  set: (botId, val) => {
    settingsDb.data.settings ||= {};
    (settingsDb.data.settings.botPremium ||= {})[botId] = Boolean(val);
    saveSoon();
  },
});

import { groupsDb, saveGroup } from "../database.js";
import { esc } from "./groupUtil.js";
import { fmtDuration } from "./groupUtil.js";

// Lock all / Unlock all: tutup & buka grup (semua member non-admin tidak bisa kirim apa pun).
// State disimpan di groups.json -> group.lock = { prev, until, by, at, reason }
//   prev  = izin default grup sebelum ditutup (dipulihkan persis saat dibuka)
//   until = timestamp (ms) otomatis dibuka, null = tutup sampai /unlockall
// Penjadwal (startLockScheduler) mengecek tiap 15 detik sehingga timer tetap jalan setelah bot restart.

const SEND_KEYS = [
  "can_send_messages", "can_send_audios", "can_send_documents", "can_send_photos", "can_send_videos",
  "can_send_video_notes", "can_send_voice_notes", "can_send_polls", "can_send_other_messages", "can_add_web_page_previews",
];

export const OPEN_PERMS = Object.fromEntries(SEND_KEYS.map((k) => [k, true]));
const CLOSED_PERMS = Object.fromEntries(SEND_KEYS.map((k) => [k, false]));

export const MIN_LOCK_SEC = 30;
export const MAX_LOCK_SEC = 30 * 86400;

const TICK_MS = 15 * 1000;
const FATAL = /forbidden|blocked|chat not found|kicked|group chat was deleted|deactivated|not a member/i;
const errText = (e) => String(e?.description || e?.message || e).replace(/^\d+:\s*/, "").replace(/^Bad Request:\s*/i, "");

export const getLock = (chatId) => groupsDb.data.groups?.[String(chatId)]?.lock || null;

/** Tutup grup. sec = detik (null = sampai dibuka manual). Mengembalikan { already, lock }. */
export async function lockGroup(telegram, chatId, { sec = null, by = null, reason = "" } = {}) {
  const cur = getLock(chatId);
  const until = sec ? Date.now() + sec * 1000 : null;

  // sudah terkunci oleh bot: cukup perbarui timer (izin asli tetap yang pertama kali disimpan)
  if (cur) {
    const lock = { ...cur, until, by: by ? String(by) : cur.by, reason: reason || cur.reason || "", at: Date.now() };
    await saveGroup(chatId, { lock });
    return { already: true, lock };
  }

  const chat = await telegram.getChat(chatId);
  const prev = chat.permissions || { ...OPEN_PERMS };
  await telegram.setChatPermissions(chatId, { ...prev, ...CLOSED_PERMS });
  const lock = { prev, until, by: by ? String(by) : null, reason, at: Date.now() };
  await saveGroup(chatId, { lock });
  return { already: false, lock };
}

/** Buka grup: pulihkan izin sebelum ditutup (kalau dulu sudah tertutup, dibuka penuh). */
export async function unlockGroup(telegram, chatId) {
  const cur = getLock(chatId);
  const prev = cur?.prev && cur.prev.can_send_messages ? cur.prev : null;
  let perms = prev;
  if (!perms) {
    const chat = await telegram.getChat(chatId).catch(() => null);
    perms = { ...(chat?.permissions || {}), ...OPEN_PERMS };
  }
  await telegram.setChatPermissions(chatId, perms);
  await saveGroup(chatId, { lock: null });
  return Boolean(cur);
}

const tries = new Map(); // chatId -> jumlah gagal buka otomatis

async function tick(telegram) {
  const now = Date.now();
  for (const [chatId, g] of Object.entries(groupsDb.data.groups || {})) {
    // ── buka otomatis (dari /lockall <durasi>) ──
    const lock = g?.lock;
    if (!lock?.until || lock.until > now) continue;
    try {
      await unlockGroup(telegram, chatId);
      tries.delete(chatId);
      await telegram
        .sendMessage(chatId, `🔓 <b>Grup dibuka otomatis</b>\nWaktu tutup <b>${esc(fmtDuration(Math.round((lock.until - lock.at) / 1000)))}</b> sudah habis. Semua member bisa mengirim pesan lagi.`, { parse_mode: "HTML" })
        .catch(() => {});
    } catch (e) {
      const n = (tries.get(chatId) || 0) + 1;
      tries.set(chatId, n);
      if (FATAL.test(errText(e))) {
        // bot sudah dikeluarkan / grup dihapus: bersihkan state
        await saveGroup(chatId, { lock: null }).catch(() => {});
        tries.delete(chatId);
      } else if (n >= 5) {
        // tidak punya izin: berhenti mencoba, minta admin membuka manual
        await saveGroup(chatId, { lock: { ...lock, until: null } }).catch(() => {});
        tries.delete(chatId);
        await telegram
          .sendMessage(chatId, `⚠️ <b>Gagal membuka grup otomatis</b>\n${esc(errText(e))}\nPastikan bot admin dengan izin <b>Blokir pengguna</b>, lalu ketik <code>/unlockall</code>.`, { parse_mode: "HTML" })
          .catch(() => {});
      } else {
        console.warn(`[LOCK] buka otomatis ${chatId} gagal (${n}/5): ${errText(e)}`);
      }
    }
  }
}

/** Dipanggil sekali dari index.js setelah bot aktif */
export function startLockScheduler(telegram) {
  if (globalThis.__lockTimer) clearInterval(globalThis.__lockTimer);
  globalThis.__lockTimer = setInterval(() => tick(telegram).catch((e) => console.error("[LOCK] tick:", e)), TICK_MS);
  globalThis.__lockTimer.unref?.();
  tick(telegram).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════
// MODE KETAT — flag per grup + mute otomatis untuk semua satpam.
//
// Flag disimpan di database: group.modeketat = { on, prev, at }
//   on   = Mode Ketat sedang aktif
//   prev = status satpam SEBELUM Mode Ketat dinyalakan (dipulihkan saat /modeketat off)
//   at   = waktu diaktifkan (ms)
//
// ANTI DELAY:
//   • isStrict() hanya baca memori (tanpa await).
//   • strictMute() mengembalikan Promise yang LANGSUNG dijalankan; pemanggil memulainya bersamaan
//     dengan penghapusan pesan (tidak saling menunggu) dan baru menunggu hasilnya untuk teks peringatan.
//   • Pelanggar yang sama dalam 3 detik (album, pesan beruntun) tidak memicu panggilan API ganda.
// ═══════════════════════════════════════════════════════════════════════
import { MUTE_PERMS } from "./groupUtil.js";

export const STRICT_MUTE_SEC = 1800; // 30 menit

/** Apakah Mode Ketat aktif di grup ini? (g = hasil getGroup) */
export const isStrict = (g) => Boolean(g?.modeketat?.on);

const DEDUP_MS = 3000;
const WARN_GAP = 600_000;
const recent = new Map(); // "chat:user" -> waktu mute terakhir
const warned = new Map(); // chatId -> waktu peringatan izin terakhir

const trim = (map, max = 2000) => {
  if (map.size > max) map.delete(map.keys().next().value);
};

function warnNoRight(tg, chatId) {
  const now = Date.now();
  if (now - (warned.get(chatId) || 0) < WARN_GAP) return;
  warned.set(chatId, now);
  trim(warned, 500);
  tg.sendMessage(
    chatId,
    "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> <b>Mode Ketat</b> belum bisa membisukan pelanggar. Jadikan bot <b>admin</b> dengan izin <b>Blokir pengguna</b> dan <b>Hapus pesan</b>.",
    { parse_mode: "HTML" }
  ).catch(() => {});
}

/**
 * Mute user 30 menit. Mulai dipanggil TANPA await agar jalan bersamaan dengan hapus pesan.
 * Tidak pernah melempar error; resolve true bila mute berhasil (atau sudah diproses beberapa detik lalu).
 */
export function strictMute(tg, chatId, userId, seconds = STRICT_MUTE_SEC) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  if (now - (recent.get(key) || 0) < DEDUP_MS) return Promise.resolve(true);
  recent.set(key, now);
  trim(recent);
  return tg
    .restrictChatMember(chatId, userId, { permissions: MUTE_PERMS, until_date: Math.floor(now / 1000) + Math.max(60, seconds) })
    .then(() => true)
    .catch(() => {
      recent.delete(key);
      warnNoRight(tg, chatId);
      return false;
    });
}

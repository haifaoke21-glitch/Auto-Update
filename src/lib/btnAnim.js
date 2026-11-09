// Animasi warna tombol inline (dipakai bersama oleh menu, Cpanel, CVPS & Jadi Bot).
// Warna Bot API 9.4+: primary = biru, danger = merah, success = hijau.
// Siklus: biru -> merah -> hijau, ganti tiap 3 detik, berhenti otomatis setelah beberapa menit.
// Mode disko (/disko on|off, khusus owner): ON = warna berganti tiap 3 detik; OFF = warna tetap (biru).
// Di kedua mode SEMUA tombol selalu satu warna yang sama (tidak campur) supaya rapi.
import config from "../../config.js";
import { settingsDb } from "../database.js";

const COLORS = ["primary", "danger", "success"];
const ANIM_ENABLED = config.menuColorAnimation !== false;
const ANIM_INTERVAL = Math.max(config.menuColorInterval || 3000, 3000); // minimal 3 detik
const ANIM_DURATION = config.menuColorDuration ?? 120000; // berhenti otomatis setelah 2 menit (hindari rate limit)
const MAX_ACTIVE = 30; // batas pesan yang beranimasi bersamaan
const anims = new Map();

/** Mode disko aktif? Default mengikuti config.menuColorAnimation (aktif), bisa diubah owner lewat /disko */
export const isDisko = () => {
  const v = settingsDb.data.settings?.disko;
  return typeof v === "boolean" ? v : ANIM_ENABLED;
};
export async function setDisko(on) {
  settingsDb.data.settings ||= {};
  settingsDb.data.settings.disko = Boolean(on);
  await settingsDb.write();
  if (!on) for (const key of [...anims.keys()]) stopAnim(key); // matikan semua animasi yang sedang jalan
}

const notModified = (e) => /message is not modified/i.test(e?.message || "");

/** Beri semua tombol warna yang SAMA: ke-i (berputar) saat disko ON, warna tetap (biru) saat OFF */
export function paint(markup, i = 0) {
  const color = isDisko() ? COLORS[i % COLORS.length] : COLORS[0];
  return { ...markup, inline_keyboard: markup.inline_keyboard.map((row) => row.map((b) => ({ ...b, style: color }))) };
}

export function stopAnim(key) {
  const a = anims.get(key);
  if (a) { clearTimeout(a.timer); anims.delete(key); }
}

/** Hentikan animasi pesan tertentu (chatId + messageId) */
export const stopAnimFor = (chatId, messageId) => stopAnim(`${chatId}:${messageId}`);

export function startAnim(telegram, chatId, messageId, markup) {
  if (!isDisko() || !chatId || !messageId || !markup?.inline_keyboard?.length) return;
  const key = `${chatId}:${messageId}`;
  stopAnim(key);
  if (anims.size >= MAX_ACTIVE) stopAnim(anims.keys().next().value); // buang yang paling lama
  const startedAt = Date.now();
  const a = { tick: 0, timer: null };
  anims.set(key, a);
  const step = async () => {
    if (Date.now() - startedAt >= ANIM_DURATION) return stopAnim(key);
    a.tick++;
    try {
      await telegram.callApi("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: paint(markup, a.tick),
      });
    } catch (err) {
      if (!notModified(err)) return stopAnim(key); // pesan dihapus / kena rate limit -> berhenti
    }
    if (anims.get(key) === a) { a.timer = setTimeout(step, ANIM_INTERVAL); a.timer.unref?.(); }
  };
  a.timer = setTimeout(step, ANIM_INTERVAL);
  a.timer.unref?.();
}

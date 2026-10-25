import config from "../../config.js";
import { escH } from "./util.js";

// Indikator loading saat command berjalan:
//  1) chat action ("sedang mengetik/mengirim...") terus diperbarui selama command jalan
//  2) pesan loading, HANYA muncul kalau command belum selesai setelah loading.delayMs,
//     dan otomatis dihapus begitu command selesai
// Plugin yang sudah punya pesan tunggu sendiri cukup menambah `loading: false` (chat action tetap jalan).
// Plugin bisa memilih chat action lain lewat `loadingAction: "upload_photo"` dsb.

const ACTION_BY_CATEGORY = {
  download: "upload_video",
  canvas: "upload_photo",
  sticker: "upload_photo",
};

export async function withLoading(ctx, plugin, fn) {
  const cfg = config.loading || {};
  if (cfg.feature === false) return fn();

  const action = plugin.loadingAction || ACTION_BY_CATEGORY[plugin.category] || "typing";
  const ping = () => ctx.sendChatAction(action).catch(() => {});
  ping();
  const actionTimer = setInterval(ping, 4000); // chat action hilang setelah ~5 detik
  const killPing = setTimeout(() => clearInterval(actionTimer), 5 * 60_000); // jangan "mengetik" selamanya bila command menggantung
  killPing.unref?.();

  let notice = null; // promise pesan loading
  const showTimer =
    plugin.loading === false
      ? null
      : setTimeout(() => {
          notice = ctx.reply(cfg.text ? escH(cfg.text) : "<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Sedang memproses, mohon tunggu...", { parse_mode: "HTML" }).catch(() => null);
        }, cfg.delayMs ?? 800);

  try {
    return await fn();
  } finally {
    clearInterval(actionTimer);
    clearTimeout(killPing);
    if (showTimer) clearTimeout(showTimer);
    if (notice) {
      const m = await notice;
      if (m) ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {});
    }
  }
}

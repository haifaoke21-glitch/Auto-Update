// ═══════════════════════════════════════════════════════════════════════
// ADMIN CACHE — cek admin grup TANPA menunggu API Telegram di setiap pelanggaran.
// Dulu tiap satpam (antilink, antispam, antiflood, dll) memanggil getChatMember dulu baru menghapus pesan,
// jadi pesan pelanggar baru hilang setelah 1 putaran jaringan. Sekarang daftar admin disimpan di memori
// (diisi di latar belakang saat ada pesan grup) sehingga pengecekan berjalan instan.
//   • TTL 60 detik; di-refresh otomatis di latar belakang.
//   • Dibuang seketika saat ada update chat_member (admin ditambah/dicopot) & setelah /promote /demote.
//   • Bila daftar gagal dimuat, jatuh ke pengecekan langsung (isGroupAdmin) supaya tidak salah tindak.
// ═══════════════════════════════════════════════════════════════════════
import { isGroupAdmin as liveIsAdmin } from "../middleware.js";

const TTL = 60_000;
const cache = new Map(); // chatId -> { at, ids:Set }
const pending = new Map(); // chatId -> Promise (hindari panggilan ganda)

const isGroup = (c) => c && (c.type === "group" || c.type === "supergroup");
const fresh = (c) => c && Date.now() - c.at < TTL;

function load(tg, chatId) {
  let p = pending.get(chatId);
  if (p) return p;
  p = tg
    .getChatAdministrators(chatId)
    .then((list) => {
      const info = { at: Date.now(), ids: new Set(list.map((a) => a.user.id)) };
      cache.set(chatId, info);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return info;
    })
    .catch(() => null)
    .finally(() => pending.delete(chatId));
  pending.set(chatId, p);
  return p;
}

/** Buang cache grup (panggil setelah admin berubah) */
export const dropAdmins = (chatId) => cache.delete(chatId);

/** Middleware: isi/refresh daftar admin di latar belakang (tidak menahan pesan) */
export function warmAdmins(ctx, next) {
  const chat = ctx.chat;
  if (isGroup(chat) && !fresh(cache.get(chat.id))) load(ctx.telegram, chat.id);
  return next();
}

/** Middleware: admin berubah -> cache dibuang */
export function adminCacheWatch(ctx, next) {
  const chat = ctx.update?.chat_member?.chat;
  if (chat) dropAdmins(chat.id);
  return next?.();
}

/** Apakah pengirim pesan admin/creator? Instan bila cache segar. */
export async function isAdminFast(ctx, userId = ctx.from?.id) {
  const chat = ctx.chat;
  if (!isGroup(chat) || userId == null) return false;
  const c = cache.get(chat.id);
  if (fresh(c)) return c.ids.has(userId);
  const info = await load(ctx.telegram, chat.id);
  return info ? info.ids.has(userId) : liveIsAdmin(ctx);
}

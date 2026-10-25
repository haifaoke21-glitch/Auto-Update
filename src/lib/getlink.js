import { getGroup, groupsDb } from "../database.js";
import { esc, mention, fullName } from "./groupUtil.js";

// Link undangan 1 orang (/getlink @username).
// Link dibuat dengan "permintaan join" (creates_join_request): siapa pun yang membuka link hanya mengajukan
// permintaan, lalu bot MENYETUJUI hanya jika dia orang yang dituju (cocok @username / ID), selain itu DITOLAK.
// Setelah berhasil dipakai, link langsung dicabut sehingga tidak bisa dipakai lagi.
// Data link tersimpan di database grup: groups[id].getlinks = { [link]: { username, userId, by, exp } }

export const MAX_PENDING = 20; // batas link aktif per grup (anti spam)

const norm = (u) => String(u || "").replace(/^@/, "").toLowerCase();

/** Hapus catatan link yang sudah kedaluwarsa (Telegram juga menonaktifkannya sendiri) */
export function purgeExpired(chatId) {
  const g = getGroup(chatId);
  g.getlinks ||= {};
  const now = Math.floor(Date.now() / 1000);
  for (const [k, v] of Object.entries(g.getlinks)) if (v.exp && v.exp <= now) delete g.getlinks[k];
  return g.getlinks;
}

export async function saveLinks() {
  await groupsDb.write().catch(() => {});
}

/** Handler update chat_join_request: setujui hanya target link /getlink, tolak yang lain */
export async function joinRequestHandler(ctx, next) {
  const req = ctx.update?.chat_join_request;
  if (!req) return next?.();
  const chatId = req.chat.id;
  const link = req.invite_link?.invite_link;
  const g = getGroup(chatId);
  const rec = link ? g.getlinks?.[link] : null;
  if (!rec) return next?.(); // bukan link buatan /getlink -> biarkan admin yang memutuskan

  const user = req.from;
  const match = (rec.userId && String(rec.userId) === String(user.id)) || (rec.username && norm(user.username) === rec.username);
  const tg = ctx.telegram;

  if (!match) {
    await tg.declineChatJoinRequest(chatId, user.id).catch(() => {});
    if (req.user_chat_id) tg.sendMessage(req.user_chat_id, "🚫 Link undangan ini khusus untuk pengguna lain, jadi permintaanmu ditolak.").catch(() => {});
    return;
  }

  try {
    await tg.approveChatJoinRequest(chatId, user.id);
  } catch (e) {
    console.warn("[GETLINK] approve gagal:", e?.description || e?.message);
    return;
  }
  // link sekali pakai: cabut & hapus catatan
  await tg.revokeChatInviteLink(chatId, link).catch(() => {});
  delete g.getlinks[link];
  await saveLinks();
  tg.sendMessage(chatId, `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> ${mention(user.id, fullName(user))} bergabung lewat link undangan pribadi.`, { parse_mode: "HTML" }).catch(() => {});
}

import { getGroup, groupsDb } from "../database.js";

// Telegram Bot API tidak bisa mengambil daftar semua member grup. Bot mencatat sendiri siapa yang
// pernah aktif / masuk di grup (id saja) supaya /tagall bisa menyebut mereka.
const MAX_TRACKED = 2000;
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; groupsDb.write().catch(() => {}); } }, 30000).unref?.();

export function touch(chatId, user) {
  if (!user || user.is_bot) return;
  const g = getGroup(chatId);
  g.members ||= {};
  const id = String(user.id);
  if (id === "777000") return;
  g.members[id] = Date.now();
  const keys = Object.keys(g.members);
  if (keys.length > MAX_TRACKED) {
    keys.sort((a, b) => g.members[a] - g.members[b]).slice(0, keys.length - MAX_TRACKED).forEach((k) => delete g.members[k]);
  }
  dirty = true;
}

/** Middleware: catat pengirim pesan & member baru/keluar di grup */
export async function memberTrackerHandler(ctx, next) {
  const chat = ctx.chat;
  if (chat && (chat.type === "group" || chat.type === "supergroup") && ctx.message) {
    const m = ctx.message;
    touch(chat.id, m.sender_chat ? null : ctx.from);
    for (const u of m.new_chat_members || []) touch(chat.id, u);
    if (m.left_chat_member) {
      const g = getGroup(chat.id);
      if (g.members) { delete g.members[String(m.left_chat_member.id)]; dirty = true; }
    }
  }
  return next();
}

/** Update chat_member: catat join/leave walau member tidak pernah chat (bot harus admin) */
export async function chatMemberTrackerHandler(ctx, next) {
  const u = ctx.update.chat_member;
  const chat = u?.chat;
  if (u && chat && (chat.type === "group" || chat.type === "supergroup")) {
    const st = u.new_chat_member?.status;
    if (["member", "administrator", "creator", "restricted"].includes(st) && !(st === "restricted" && u.new_chat_member.is_member === false)) {
      touch(chat.id, u.new_chat_member.user);
    } else if (["left", "kicked"].includes(st)) {
      const g = getGroup(chat.id);
      if (g.members) { delete g.members[String(u.new_chat_member.user.id)]; dirty = true; }
    }
  }
  return next?.();
}

/** Reaksi emoji juga menandakan member ada di grup */
export async function reactionTrackerHandler(ctx, next) {
  const r = ctx.update.message_reaction;
  if (r?.user && r.chat && (r.chat.type === "group" || r.chat.type === "supergroup")) touch(r.chat.id, r.user);
  return next?.();
}

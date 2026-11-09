import config from "../config.js";
import { premiumDb, partnerDb, ownerDb } from "./database.js";

/** Owner dari config.js + owner yang ditambahkan lewat /addowner (tersimpan di database) */
export function allOwnerIds() {
  const extra = ownerDb.data.owner || [];
  return [...new Set([...config.ownerIds, ...extra].map(String))];
}

export function isOwner(userId) {
  return allOwnerIds().includes(String(userId));
}

export function isPartner(userId) {
  return (partnerDb.data.partner || []).includes(String(userId));
}

export function isPremium(userId) {
  return (premiumDb.data.premium || []).includes(String(userId));
}

/** Wajib dipanggil dari dalam grup */
export async function isGroupAdmin(ctx) {
  if (ctx.chat.type === "private") return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

export async function isBotAdmin(ctx) {
  if (ctx.chat.type === "private") return true;
  try {
    const me = await ctx.telegram.getMe();
    const member = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

/** Guard sederhana untuk dipakai di awal handler plugin */
export function requireOwner(ctx) {
  if (!isOwner(ctx.from.id)) {
    ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini khusus owner bot.", { parse_mode: "HTML" });
    return false;
  }
  return true;
}

export async function requireGroup(ctx) {
  if (ctx.chat.type === "private") {
    await ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini hanya bisa dipakai di dalam grup.", { parse_mode: "HTML" });
    return false;
  }
  return true;
}

export async function requireGroupAdmin(ctx) {
  if (!(await requireGroup(ctx))) return false;
  const ok = (await isGroupAdmin(ctx)) || isOwner(ctx.from.id);
  if (!ok) {
    await ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini khusus admin grup.", { parse_mode: "HTML" });
    return false;
  }
  return true;
}

/** Cooldown antar-perintah per user, sederhana in-memory */
const cooldowns = new Map();
export function checkCooldown(userId, commandName, ms = 3000) {
  const key = `${userId}:${commandName}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < ms) return false;
  cooldowns.set(key, now);
  return true;
}

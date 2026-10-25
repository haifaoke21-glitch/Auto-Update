import { getUser, saveUser } from "../../database.js";
import { escH } from "../util.js";

/** Mention user yang aman untuk parse_mode HTML */
export const mention = (id, name) => `<a href="tg://user?id=${id}">${escH(name || "Pemain")}</a>`;

export const newId = () => Math.random().toString(36).slice(2, 8);

/** Tambah koin/exp ke user (error disimpan diam-diam supaya game tidak macet) */
export async function reward(userId, koin = 0, exp = 0) {
  try {
    const u = getUser(userId);
    await saveUser(userId, { koin: (u.koin || 0) + koin, exp: (u.exp || 0) + exp });
  } catch (err) {
    console.error("[GAME] gagal beri hadiah:", err.message);
  }
}

/** Edit pesan game lewat telegram API (aman dari "message is not modified") */
export async function editMsg(g, text, reply_markup) {
  try {
    await g.telegram.editMessageText(g.chatId, g.msgId, undefined, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup,
    });
    return true;
  } catch (err) {
    if (!/not modified/i.test(err?.description || err?.message || "")) console.error("[GAME] edit gagal:", err?.description || err?.message);
    return false;
  }
}

export async function answer(ctx, text, alert = false) {
  try {
    await ctx.answerCbQuery(text, alert ? { show_alert: true } : undefined);
  } catch {}
}

/**
 * Penyimpanan game dengan masa kedaluwarsa. Setiap aktivitas memanggil bump() untuk
 * memperpanjang masa hidup; saat habis, game dihapus dan onExpire(game) dipanggil.
 */
export class GameStore {
  constructor(ttlMs, onExpire) {
    this.ttl = ttlMs;
    this.onExpire = onExpire;
    this.map = new Map();
  }
  get(id) { return this.map.get(id); }
  set(id, g) { g.id = id; this.map.set(id, g); this.bump(g); return g; }
  has(id) { return this.map.has(id); }
  delete(id) {
    const g = this.map.get(id);
    if (g?.expiry) clearTimeout(g.expiry);
    this.map.delete(id);
  }
  bump(g, ttl = this.ttl) {
    if (g.expiry) clearTimeout(g.expiry);
    g.expiry = setTimeout(async () => {
      if (this.map.get(g.id) !== g) return;
      this.map.delete(g.id);
      try { await this.onExpire?.(g); } catch {}
    }, ttl);
    g.expiry.unref?.();
  }
}

export const isPlayerBot = (u) => !!u?.is_bot;

/** Cek apakah user admin/creator di chat (dipakai untuk tombol "akhiri game") */
export async function isChatAdmin(ctx, userId) {
  try {
    if (ctx.chat?.type === "private") return true;
    const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ["creator", "administrator"].includes(m.status);
  } catch {
    return false;
  }
}

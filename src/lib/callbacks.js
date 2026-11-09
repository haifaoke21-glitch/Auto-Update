// Registry callback inline-button: plugin mendaftarkan prefix, index.js meneruskan callback_query ke sini
import { CLONE_BLOCKED_CALLBACKS, CLONE_BLOCKED_TEXT, isCloneCtx } from "./cloneGuard.js";

const registry = new Map();

export function registerCallback(prefix, fn) {
  registry.set(prefix, fn);
}

export async function callbackHandler(ctx) {
  const data = ctx.callbackQuery?.data || "";
  const prefix = data.split(":")[0];
  const fn = registry.get(prefix);
  if (!fn) return ctx.answerCbQuery();
  if (isCloneCtx(ctx) && CLONE_BLOCKED_CALLBACKS.has(prefix)) return ctx.answerCbQuery(CLONE_BLOCKED_TEXT, { show_alert: true });
  // Wajib join juga berlaku untuk semua tombol inline (menu, game, dll)
  // (import dinamis agar tidak terjadi circular import dengan forceJoin.js)
  const { requireJoinCallback } = await import("./forceJoin.js");
  if (!(await requireJoinCallback(ctx))) return;
  try {
    await fn(ctx, data.split(":").slice(1));
  } catch (err) {
    console.error("[CALLBACK]", err);
    try { await ctx.answerCbQuery("Terjadi kesalahan"); } catch {}
  }
}

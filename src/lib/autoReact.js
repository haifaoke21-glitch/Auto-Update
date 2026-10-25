import { settingsDb } from "../database.js";

// Auto react: bot memberi reaksi emoji acak ke pesan masuk. Hanya owner yang bisa on/off (/autoreact).
// Bot bisa memberi reaksi di grup bila reaksi diizinkan di grup tsb.

const EMOJIS = ["👍", "❤", "🔥", "🥰", "👏", "😁", "🎉", "🤩", "👌", "😍", "💯", "⚡", "🏆", "🤝", "😎", "🫡"];
const MIN_GAP = 1200; // jeda minimal per chat (hindari rate limit Telegram)
const BLOCK_MS = 10 * 60 * 1000; // chat yang menolak reaksi diistirahatkan 10 menit

export const isAutoReactOn = () => Boolean(settingsDb.data.settings?.autoReact);
export async function setAutoReact(on) {
  settingsDb.data.settings ||= {};
  settingsDb.data.settings.autoReact = on;
  await settingsDb.write();
}

const last = new Map();
const blocked = new Map();

/** Middleware non-blocking: selalu lanjut ke handler berikutnya */
export async function autoReactHandler(ctx, next) {
  const msg = ctx.message;
  if (msg && isAutoReactOn() && ctx.from && !ctx.from.is_bot && !msg.new_chat_members && !msg.left_chat_member) {
    const cid = ctx.chat.id;
    const now = Date.now();
    if (now >= (blocked.get(cid) || 0) && now - (last.get(cid) || 0) >= MIN_GAP) {
      last.set(cid, now);
      if (last.size > 1000) last.delete(last.keys().next().value);
      const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      ctx.telegram.setMessageReaction(cid, msg.message_id, [{ type: "emoji", emoji }]).catch((err) => {
        const t = String(err?.description || err?.message || "").toLowerCase();
        if (t.includes("reaction") || t.includes("not enough rights") || t.includes("chat not found")) blocked.set(cid, Date.now() + BLOCK_MS);
        else if (t.includes("too many requests")) blocked.set(cid, Date.now() + 30000);
      });
    }
  }
  return next();
}

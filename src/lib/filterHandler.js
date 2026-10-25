import config from "../../config.js";
import { getGroup } from "../database.js";
import { matchFilter, sendFilter } from "./filterCore.js";

// Pemicu filter: setiap pesan teks / caption di grup dicocokkan dengan kata kunci filter grup itu (/filter).
// Pesan perintah (/..., atau prefix lain dari config.js) diabaikan. Selalu lanjut ke handler berikutnya.

const GAP = 4000; // jeda minimum untuk kata kunci yang sama di grup yang sama (anti spam)
const last = new Map();

const prefixes = () => ["/", config.prefix, ...(config.altPrefixes || [])].filter(Boolean);
const isCommandText = (t) => prefixes().some((p) => t.startsWith(p));

export async function filterHandler(ctx, next) {
  try {
    const chat = ctx.chat;
    const msg = ctx.message;
    if (!msg || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return next();
    if (!ctx.from || ctx.from.is_bot) return next();

    const text = msg.text ?? msg.caption ?? "";
    if (!text || isCommandText(text.trimStart())) return next();

    const filters = getGroup(chat.id).filters;
    if (!filters) return next();
    const key = matchFilter(filters, text);
    if (!key) return next();

    const stamp = `${chat.id}:${key}`;
    const now = Date.now();
    if (now - (last.get(stamp) || 0) < GAP) return next();
    last.set(stamp, now);
    if (last.size > 500) last.delete(last.keys().next().value);

    await sendFilter(ctx, filters[key], { replyTo: msg.message_id });
  } catch (e) {
    console.warn("[FILTER] gagal kirim:", e?.description || e?.message || e);
  }
  return next();
}

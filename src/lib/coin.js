import moment from "moment-timezone";
import config from "../../config.js";
import { getUser, usersDb } from "../database.js";
import { isOwner } from "../middleware.js";
import { escH } from "./util.js";

// Sistem koin: fitur berbayar (config.js -> coin) + klaim harian.

const cfg = () => config.coin || {};
const TZ = () => cfg().timezone || "Asia/Jakarta";

/** Biaya command ini (0 = gratis). Plugin bisa override lewat properti `cost` */
export function getCost(plugin, command) {
  const c = cfg();
  if (!c.enabled && c.enabled !== undefined) return 0;
  if ((c.freeCommands || []).map((x) => String(x).toLowerCase()).includes(command)) return 0;
  if (typeof plugin.cost === "number") return Math.max(0, plugin.cost);
  if ((c.paidCategories || []).includes(plugin.category)) return Math.max(0, Number(c.cost) || 0);
  return 0;
}

/** Potong koin secara atomik (tanpa await di antara cek & potong). Return true kalau cukup */
export function spend(userId, amount) {
  const u = getUser(userId);
  if ((u.koin || 0) < amount) return false;
  u.koin -= amount;
  usersDb.write().catch((e) => console.error("[COIN] Gagal simpan:", e.message));
  return true;
}

export function refund(userId, amount) {
  const u = getUser(userId);
  u.koin = (u.koin || 0) + amount;
  usersDb.write().catch((e) => console.error("[COIN] Gagal simpan:", e.message));
}

const FAIL_START = /^\s*(❌|⚠️|📭|contoh\b|cara pakai\b)/i; // pesan gagal / petunjuk pemakaian
const MEDIA = ["replyWithPhoto", "replyWithVideo", "replyWithAudio", "replyWithDocument", "replyWithAnimation", "replyWithMediaGroup", "replyWithVoice", "replyWithSticker"];

/**
 * Jalankan command berbayar. Koin dipotong di awal, lalu DIKEMBALIKAN otomatis kalau:
 *  - command melempar error, atau
 *  - hasilnya hanya pesan gagal (❌ / ⚠️) atau petunjuk "Contoh: ..." tanpa mengirim media/hasil sukses.
 */
export async function runPaid(ctx, cost, fn) {
  const uid = ctx.from.id;
  let failed = false;
  let delivered = false;

  const textFns = ["reply", "replyWithMarkdown", "replyWithHTML"];
  for (const name of textFns) {
    const orig = ctx[name]?.bind(ctx);
    if (!orig) continue;
    ctx[name] = (text, ...rest) => {
      // Awalan emoji bisa terbungkus <tg-emoji> / <b>: bersihkan tag dulu sebelum dicek.
      const plain = typeof text === "string" ? text.replace(/<[^>]*>/g, "") : text;
      if (typeof plain === "string" && FAIL_START.test(plain)) failed = true;
      else if (typeof plain === "string" && !/^\s*(⏳|🔎)/.test(plain)) delivered = true; // hasil teks sukses (bukan pesan tunggu)
      return orig(text, ...rest);
    };
  }
  for (const name of MEDIA) {
    const orig = ctx[name]?.bind(ctx);
    if (!orig) continue;
    ctx[name] = (...a) => {
      const p = orig(...a);
      return Promise.resolve(p).then((r) => ((delivered = true), r));
    };
  }

  try {
    await fn();
  } catch (err) {
    refund(uid, cost);
    throw err;
  }
  if (failed && !delivered) {
    refund(uid, cost);
    return; // gagal -> koin dikembalikan, balasan gagal asli dari command tetap dipakai
  }
  await notifySpent(ctx, cost);
}

function notifyOpts(ctx) {
  return {
    reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    ...(ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
  };
}

/** Notif setelah command berbayar sukses: "Coin -10, sisa coin kamu: X" */
async function notifySpent(ctx, cost) {
  try {
    const sisacoin = getUser(ctx.from.id).koin || 0;
    await ctx.telegram.sendMessage(ctx.chat.id, `<tg-emoji emoji-id="6089104607328342288">💰</tg-emoji> Coin -${escH(cost)}\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin kamu: ${escH(sisacoin)}`, { parse_mode: "HTML", ...notifyOpts(ctx) });
  } catch (e) {
    console.warn("[COIN] Gagal kirim notif coin:", e.message);
  }
}

// ===== Klaim harian =====
const dayKey = () => moment.tz(TZ()).format("YYYY-MM-DD");

/** Cek + tandai klaim tanpa await (aman dari double-tap). Return { ok, amount, koin } atau { ok:false, wait } */
export function claimDaily(userId) {
  const amount = Number(cfg().dailyClaim) || 500;
  const u = getUser(userId);
  const today = dayKey();
  if (u.lastClaim === today) {
    const now = moment.tz(TZ());
    const ms = now.clone().add(1, "day").startOf("day").diff(now);
    return { ok: false, wait: ms };
  }
  u.lastClaim = today;
  u.koin = (u.koin || 0) + amount;
  usersDb.write().catch((e) => console.error("[COIN] Gagal simpan:", e.message));
  return { ok: true, amount, koin: u.koin };
}

/** Tambah coin ke user (dipakai giveaway owner). Return saldo baru */
export function addCoin(userId, amount) {
  const u = getUser(userId);
  u.koin = (u.koin || 0) + amount;
  usersDb.write().catch((e) => console.error("[COIN] Gagal simpan:", e.message));
  return u.koin;
}

/** Cari user (yang pernah memakai bot) dari @username. Return data user atau null */
export function findUserByUsername(username) {
  const uname = String(username).replace(/^@/, "").toLowerCase();
  if (!uname) return null;
  return Object.values(usersDb.data.users).find((u) => (u.username || "").toLowerCase() === uname) || null;
}

export function formatWait(ms) {
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} jam ${m % 60} menit` : `${m} menit`;
}

export { isOwner };

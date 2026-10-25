// ═══════════════════════════════════════════════════════════════════════
//  CFD  broadcast (owner) + blacklist
//  Diport dari cfd-pack (userbot) ke bot Telegraf.
//
//  Beda mendasar dengan versi userbot: bot (token BotFather) TIDAK bisa
//  membaca daftar dialog seperti akun user. Jadi target diambil dari
//  database bot sendiri:
//    group   -> grup yang tercatat di groupsDb (bot pernah aktif di sana)
//    contact -> user yang pernah memakai bot (usersDb, bukan banned/blokir bot)
//    channel -> channel tempat bot jadi admin (tercatat otomatis, lihat bawah)
// ═══════════════════════════════════════════════════════════════════════
import crypto from "crypto";
import config from "../../config.js";
import { usersDb, groupsDb, cfdDb, getGroup, getUser, emitNew } from "../database.js";

export const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jeda antar kirim SENGAJA ada (anti flood Telegram). Minimal 300ms walau config diubah lebih kecil.
export const getDelayMs = () => Math.max(300, Number(config.cfd?.delayMs ?? 500));

// ───────────────────────── Blacklist ─────────────────────────
export const getBlacklist = () => cfdDb.data.blacklist;

export function isBlacklisted(chatId) {
  const id = String(chatId);
  return cfdDb.data.blacklist.some((it) => String(it.id) === id);
}

export async function addToBlacklist(chatId, title) {
  const id = String(chatId);
  if (isBlacklisted(id)) return { added: false, total: cfdDb.data.blacklist.length };
  cfdDb.data.blacklist.push({ id, title: title || id });
  await cfdDb.write();
  return { added: true, total: cfdDb.data.blacklist.length };
}

export async function removeFromBlacklist(chatId) {
  const id = String(chatId);
  const before = cfdDb.data.blacklist.length;
  cfdDb.data.blacklist = cfdDb.data.blacklist.filter((it) => String(it.id) !== id);
  const removed = cfdDb.data.blacklist.length !== before;
  if (removed) await cfdDb.write();
  return { removed, total: cfdDb.data.blacklist.length };
}

/**
 * Tentukan chat yang dimaksud /addbl & /unbl:
 *  - /addbl <chat_id>  -> chat dengan ID itu (bisa diketik dari mana saja)
 *  - /addbl            -> chat tempat command diketik (hanya grup; di PM wajib kasih ID)
 */
export async function resolveBlChat(ctx, arg) {
  let id = arg;
  if (!id) {
    if (ctx.chat.type === "private") return null;
    id = ctx.chat.id;
  }
  id = String(id).trim();
  if (!/^-?\d+$/.test(id)) return null;

  let title = id;
  if (id === String(ctx.chat.id) && ctx.chat.type !== "private") {
    title = ctx.chat.title || id;
  } else {
    try {
      const c = await ctx.telegram.getChat(id);
      title = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || id;
    } catch {
      /* gagal ambil nama -> pakai ID saja */
    }
  }
  return { id, title };
}

// ───────────────────────── Target ─────────────────────────
function listTargets(type) {
  if (type === "group") {
    return Object.values(groupsDb.data.groups || {})
      .filter((g) => String(g.id).startsWith("-") && !/^-(?!100)\d{12,}$/.test(String(g.id)) && !g.left)
      .map((g) => ({ id: String(g.id), title: g.title || String(g.id), type }));
  }
  if (type === "channel") {
    return Object.values(cfdDb.data.channels || {}).map((c) => ({
      id: String(c.id),
      title: c.title || String(c.id),
      type,
    }));
  }
  // contact = user yang pernah memakai bot
  return Object.values(usersDb.data.users || {})
    .filter((u) => u.id && !u.banned && !u.blockedBot && !u.noDm)
    .map((u) => ({ id: String(u.id), title: u.name || String(u.id), type: "contact" }));
}

/** Gabungan target sesuai toggle, tanpa chat sumber & chat di blacklist, tanpa duplikat */
export function collectTargets(types, sourceChatId) {
  const seen = new Set();
  const out = [];
  for (const type of ["group", "channel", "contact"]) {
    if (!types[type]) continue;
    for (const t of listTargets(type)) {
      if (t.id === String(sourceChatId) || isBlacklisted(t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export function countTargets(types, sourceChatId) {
  const counts = { group: 0, channel: 0, contact: 0 };
  for (const type of Object.keys(counts)) {
    if (types[type]) counts[type] = collectTargets({ [type]: true }, sourceChatId).length;
  }
  counts.total = collectTargets(types, sourceChatId).length;
  return counts;
}

// ───────────────────────── Pending (pilih target) ─────────────────────────
const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // token -> request

function cleanupExpired() {
  const now = Date.now();
  for (const [t, r] of pending) if (now - r.createdAt > PENDING_TTL_MS) pending.delete(t);
}

export function createPending({ ownerId, sourceChatId, sourceMessageId, buttonRows }) {
  cleanupExpired();
  const token = crypto.randomBytes(6).toString("hex");
  pending.set(token, {
    ownerId: String(ownerId),
    sourceChatId,
    sourceMessageId,
    buttonRows: buttonRows || [],
    targets: { group: false, channel: false, contact: false }, // default semua OFF
    busy: false,
    createdAt: Date.now(),
  });
  return token;
}

export function getPending(token) {
  cleanupExpired();
  return pending.get(token) || null;
}

export const deletePending = (token) => pending.delete(token);

export function toggleTarget(token, type) {
  const req = getPending(token);
  if (!req || !(type in req.targets)) return null;
  req.targets[type] = !req.targets[type];
  return req;
}

// Kunci anti klik beruntun
export function tryLockBusy(token) {
  const req = getPending(token);
  if (!req || req.busy) return false;
  req.busy = true;
  return true;
}
export function unlockBusy(token) {
  const req = pending.get(token);
  if (req) req.busy = false;
}

// ───────────────────────── Running (tombol STOP) ─────────────────────────
const running = new Map(); // token -> { stopped }
export const startRun = (token) => running.set(token, { stopped: false });
export const endRun = (token) => running.delete(token);
export const isStopped = (token) => {
  const r = running.get(token);
  return !r || r.stopped;
};
export function stopRun(token) {
  const r = running.get(token);
  if (!r) return false;
  r.stopped = true;
  return true;
}

// ───────────────────────── Pengirim ─────────────────────────
function reasonOf(err) {
  return err?.response?.description || err?.message || "Tidak diketahui";
}

// Tombol yang aman dikirim ulang: buang tipe yang hanya sah di pesan asli (pay / callback_game)
const dropInvalid = (rows) =>
  (rows || [])
    .map((row) => row.filter((b) => !b.pay && !b.callback_game))
    .filter((row) => row.length);

// Versi paling aman bila Telegram menolak sebagian tombol di chat tertentu
// (mis. web_app / login_url hanya sah di kondisi tertentu): sisakan url, callback, switch, copy_text
const safeRows = (rows) =>
  (rows || [])
    .map((row) => row.filter((b) => b.url || b.callback_data || b.switch_inline_query !== undefined || b.switch_inline_query_current_chat !== undefined || b.copy_text))
    .filter((row) => row.length);

const isButtonError = (err) => /BUTTON|reply markup|reply_markup/i.test(reasonOf(err));

async function sendOne(telegram, method, target, src) {
  let rows = dropInvalid(src.buttonRows);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (method === "forward") {
        await telegram.forwardMessage(target.id, src.chatId, src.messageId);
      } else {
        // Semua tombol (URL + callback) ikut disalin. Tombol callback tetap menembak bot ini,
        // karena bot inilah yang mengirim pesan salinannya.
        const extra = rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
        await telegram.copyMessage(target.id, src.chatId, src.messageId, extra);
      }
      return;
    } catch (err) {
      const retryAfter = err?.response?.parameters?.retry_after;
      if (typeof retryAfter === "number" && attempt === 0) {
        await sleep((retryAfter + 1) * 1000); // kena rate limit -> tunggu lalu coba sekali lagi
        continue;
      }
      if (method === "copy" && rows.length && isButtonError(err)) {
        const fallback = safeRows(rows);
        if (JSON.stringify(fallback) !== JSON.stringify(rows)) {
          rows = fallback; // buang tombol bermasalah lalu coba lagi
          continue;
        }
        rows = []; // masih ditolak: kirim pesannya saja tanpa tombol, daripada gagal total
        continue;
      }
      throw err;
    }
  }
}

// Grup biasa di-upgrade jadi supergrup -> ID berubah. Pindahkan catatan (dan blacklist) ke ID baru.
async function migrateGroup(oldId, newId) {
  oldId = String(oldId);
  newId = String(newId);
  const old = groupsDb.data.groups[oldId];
  if (old) {
    groupsDb.data.groups[newId] = { ...old, ...(groupsDb.data.groups[newId] || {}), id: newId, left: false };
    delete groupsDb.data.groups[oldId];
    await groupsDb.write();
  }
  const bl = cfdDb.data.blacklist.find((it) => String(it.id) === oldId);
  if (bl) {
    bl.id = newId;
    await cfdDb.write();
  }
}

// Tandai target yang pasti tidak bisa dikirimi supaya tidak gagal terus di broadcast berikutnya
async function markDead(target, reason) {
  try {
    if (target.type === "contact") {
      const u = usersDb.data.users[target.id];
      if (!u) return;
      if (/blocked by the user|user is deactivated/i.test(reason)) u.blockedBot = true;
      else if (/can't initiate conversation|chat not found/i.test(reason)) u.noDm = true; // belum pernah /start bot di chat pribadi
      else return;
      await usersDb.write();
    } else if (target.type === "group") {
      const g = groupsDb.data.groups[target.id];
      if (g && /bot was kicked|bot is not a member|chat not found|group chat was deleted|bot was blocked/i.test(reason)) {
        g.left = true;
        await groupsDb.write();
      }
    } else if (target.type === "channel") {
      if (cfdDb.data.channels[target.id] && /bot was kicked|bot is not a member|chat not found|not enough rights|have no rights to send/i.test(reason)) {
        delete cfdDb.data.channels[target.id];
        await cfdDb.write();
      }
    }
  } catch (e) {
    console.error("[CFD] markDead:", e.message);
  }
}

/**
 * method: "forward" | "copy"
 * hooks: onStart(total), onProgress(done,total), shouldStop()
 * return { successCount, failCount, failures[{title,reason}], stopped, totalTargets }
 */
export async function executeBroadcast(telegram, req, method, hooks = {}) {
  const { onStart, onProgress, shouldStop } = hooks;
  const result = { successCount: 0, failCount: 0, failures: [], stopped: false, totalTargets: 0 };

  const targets = collectTargets(req.targets, req.sourceChatId);
  result.totalTargets = targets.length;
  if (!targets.length) return result;
  if (onStart) await Promise.resolve(onStart(targets.length)).catch(() => {});

  const src = { chatId: req.sourceChatId, messageId: req.sourceMessageId, buttonRows: req.buttonRows || [] };
  const delay = getDelayMs();

  for (const target of targets) {
    if (shouldStop && shouldStop()) {
      result.stopped = true;
      break;
    }
    try {
      try {
        await sendOne(telegram, method, target, src);
      } catch (err) {
        const newId = err?.response?.parameters?.migrate_to_chat_id;
        if (target.type !== "group" || !newId) throw err;
        await migrateGroup(target.id, newId); // grup naik jadi supergrup: pakai ID baru lalu kirim ulang
        await sendOne(telegram, method, { ...target, id: String(newId) }, src);
      }
      result.successCount++;
    } catch (err) {
      result.failCount++;
      const reason = reasonOf(err);
      result.failures.push({ title: target.title, reason });
      await markDead(target, reason);
      console.error(`[CFD] Gagal kirim ke "${target.title}" (${target.id}) [${target.type}]:`, reason);
    }
    if (onProgress) await Promise.resolve(onProgress(result.successCount + result.failCount, targets.length)).catch(() => {});
    await sleep(delay);
  }
  return result;
}

/** Ringkas alasan gagal: "<alasan> (×N)", diurut terbanyak, maksimal 3 baris */
export function summarizeFailures(failures, max = 3) {
  if (!failures?.length) return [];
  const counts = new Map();
  for (const f of failures) counts.set(f.reason, (counts.get(f.reason) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.slice(0, max).map(([r, n]) => `${esc(r)} (×${n})`);
  const rest = sorted.slice(max).reduce((s, [, n]) => s + n, 0);
  if (rest > 0) lines.push(`+${rest} alasan lainnya`);
  return lines;
}

// ───────────────────────── Pencatat chat otomatis ─────────────────────────
/** Update my_chat_member: bot masuk/keluar grup, jadi admin channel, atau diblokir user */
export async function cfdChatMemberHandler(ctx, next) {
  try {
    const upd = ctx.myChatMember;
    if (upd) {
      const chat = upd.chat;
      const status = upd.new_chat_member?.status;
      const id = String(chat.id);
      const gone = status === "left" || status === "kicked";

      if (chat.type === "channel") {
        const canPost = status === "administrator" && upd.new_chat_member.can_post_messages === true;
        if (canPost) {
          const isNew = !cfdDb.data.channels[id];
          cfdDb.data.channels[id] = { id, title: chat.title || id, username: chat.username || "" };
          if (isNew) emitNew("channel", id);
        } else {
          delete cfdDb.data.channels[id];
        }
        await cfdDb.write();
      } else if (chat.type === "group" || chat.type === "supergroup") {
        if (!gone || groupsDb.data.groups[id]) {
          const g = getGroup(id);
          g.left = gone;
          g.title = chat.title || g.title;
          await groupsDb.write();
        }
      } else if (chat.type === "private") {
        if (!gone || usersDb.data.users[id]) {
          const u = getUser(id); // user yang /start bot langsung tercatat sebagai target
          u.blockedBot = status === "kicked";
          if (!gone) u.noDm = false; // sudah membuka chat dengan bot -> bisa di-DM
          if (!u.name) u.name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
          if (!u.username && chat.username) u.username = chat.username;
          await usersDb.write();
        }
      }
    }
  } catch (err) {
    console.error("[CFD] my_chat_member:", err.message);
  }
  return next?.();
}

/** Channel yang sudah punya bot sebagai admin sebelum fitur ini ada: tercatat saat ada post baru */
export async function cfdChannelPostHandler(ctx, next) {
  try {
    const chat = ctx.chat;
    if (chat?.type === "channel" && !cfdDb.data.channels[String(chat.id)]) {
      const id = String(chat.id);
      cfdDb.data.channels[id] = { id, title: chat.title || id, username: chat.username || "" };
      emitNew("channel", id);
      await cfdDb.write();
    }
  } catch (err) {
    console.error("[CFD] channel_post:", err.message);
  }
  return next?.();
}

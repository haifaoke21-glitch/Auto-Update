// Pengingat sholat otomatis — dikontrol lewat /autosholat on <kota> | off.
// State disimpan di sholatDb (database/main/sholat.json) sehingga tetap aktif setelah bot restart.
// Setiap TICK_MS dicek semua chat yang aktif: kalau waktu lokal lokasi sudah masuk waktu sholat
// (telat maksimal GRACE_MIN menit, mis. bot baru restart) dan belum dikirim hari itu, kirim Rich Message.
import fs from "fs";
import path from "path";
import config from "../../config.js";
import { sholatDb, usersDb, groupsDb } from "../database.js";
import { getTimings } from "./sholat.js";
import { sendRichBlocks } from "./richSend.js";
import { maxBotApiUploadBytes } from "./net.js";
import { PRAYERS, localNow, zoneOfResult, reminderBlocks } from "./sholatView.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TICK_MS = 20 * 1000;
const GRACE_MIN = 5; // toleransi telat (menit): cukup untuk antrean kirim mode global + retry
const RETRY_MS = 3 * 60 * 1000;
const FATAL_SEND = /forbidden|blocked|chat not found|kicked|not enough rights|have no rights|chat_write_forbidden|deactivated/i;

// Grup di-lockall / bot di-mute / hak kirim dicabut = bisa pulih lagi, jangan dimatikan permanen
const NO_PERM = /not enough rights|have no rights|chat_write_forbidden|chat_send_plain_forbidden|chat_send_audio_forbidden|need administrator rights/i;
const NO_PERM_RETRY_MS = 3 * 60 * 60 * 1000;
const REVIVE_MS = 24 * 60 * 60 * 1000; // chat yang dimatikan otomatis dicoba lagi tiap 24 jam (kecuali bot dikick / chat hilang)
const GONE = /kicked|chat not found|deactivated/i;

const MIGRATED = /upgraded to a supergroup|migrate_to_chat_id/i;
const RATE_LIMIT = /too many requests|retry after|retry_after|\b429\b/i;

// ── antrean kirim global: jeda antar pesan + berhenti sementara saat kena 429 (batas Telegram ±30 pesan/detik) ──
const SEND_GAP_MS = 40;
let sendChain = Promise.resolve();
let pausedUntil = 0;
const throttle = () => {
  const job = sendChain.then(async () => {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
  });
  sendChain = job.then(() => sleep(SEND_GAP_MS));
  return job;
};
const notePause = (e) => {
  const n = Number(e?.response?.parameters?.retry_after ?? /retry after (\d+)/i.exec(e?.message || "")?.[1]) || 5;
  pausedUntil = Math.max(pausedUntil, Date.now() + (n + 1) * 1000);
  console.warn(`[SHOLAT] kena rate limit Telegram, kirim dijeda ${n + 1} detik`);
};

const store = () => (sholatDb.data.chats ||= {});
export const getSub = (chatId) => store()[String(chatId)] || null;

const buildSub = ({ query, place, zone, threadId, by }) => ({
  enabled: true,
  query,
  place: { label: place.label, name: place.name || null, kind: place.kind || "city", lat: place.lat, lon: place.lon, cc: place.cc || "", note: place.note || null },
  tz: zone.tz,
  offset: zone.offset,
  threadId: threadId || null,
  sent: { date: localNow(zone).date, keys: [] },
  by: by ? String(by) : null,
  at: Date.now(),
});

/** Tandai waktu sholat yang sudah lewat hari ini sebagai terkirim (tidak dikirim mundur). */
function markPassed(sub, zone, r) {
  const ln = localNow(zone);
  for (const p of PRAYERS) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(r?.times?.[p.key] || "");
    if (m && ln.minutes - (Number(m[1]) * 60 + Number(m[2])) >= 0) sub.sent.keys.push(p.key);
  }
}

/** Aktifkan pengingat untuk chat. place = hasil geocode(); r = hasil getTimings() (untuk zona waktu). */
export async function enableSub(chatId, { query, place, r, threadId, by }) {
  const zone = zoneOfResult(r);
  store()[String(chatId)] = buildSub({ query, place, zone, threadId, by });
  const sub = getSub(chatId);
  markPassed(sub, zone, r);
  await sholatDb.write();
  return sub;
}

// ── mode GLOBAL (khusus owner): on = semua user & grup aktif, off = semua mati ──
export const getGlobal = () => sholatDb.data.global || null;
export const isGlobalOn = () => Boolean(sholatDb.data.global?.enabled);

/** Semua chat tujuan: setiap user (chat pribadi) + setiap grup yang tercatat di database. */
export function allTargetIds() {
  const ids = new Set();
  for (const id of Object.keys(usersDb.data.users || {})) ids.add(String(id));
  for (const id of Object.keys(groupsDb.data.groups || {})) ids.add(String(id));
  return [...ids];
}

/** Nyalakan untuk SEMUA user & grup dengan satu lokasi. Mengembalikan { users, groups }. */
export async function enableAll({ query, place, r, by }) {
  const zone = zoneOfResult(r);
  sholatDb.data.global = {
    enabled: true,
    query,
    place: { label: place.label, name: place.name || null, kind: place.kind || "city", lat: place.lat, lon: place.lon, cc: place.cc || "", note: place.note || null },
    tz: zone.tz,
    offset: zone.offset,
    by: by ? String(by) : null,
    at: Date.now(),
  };
  const st = store();
  for (const id of allTargetIds()) {
    const keepThread = st[id]?.threadId || null; // topik grup yang sudah pernah diatur tetap dipakai
    st[id] = buildSub({ query, place, zone, threadId: keepThread, by });
    markPassed(st[id], zone, r);
  }
  await sholatDb.write();
  return countTargets();
}

/** Matikan untuk SEMUA user & grup (termasuk yang pernah diaktifkan manual). Mengembalikan jumlah chat yang dimatikan. */
export async function disableAll() {
  if (sholatDb.data.global) sholatDb.data.global.enabled = false;
  let n = 0;
  for (const sub of Object.values(store())) {
    if (sub?.enabled) { sub.enabled = false; n++; }
  }
  await sholatDb.write();
  return n;
}

export function countTargets() {
  const groups = Object.keys(groupsDb.data.groups || {}).length;
  const users = Object.keys(usersDb.data.users || {}).length;
  return { users, groups };
}

/** Saat mode global ON: user/grup baru (yang belum punya langganan) otomatis ikut aktif. */
function syncGlobalTargets() {
  const g = getGlobal();
  if (!g?.enabled || !g.place) return;
  const st = store();
  let added = false;
  for (const id of allTargetIds()) {
    const cur = st[id];
    if (cur) {
      // dimatikan otomatis (mis. user belum /start, grup sempat dikunci): coba lagi tiap 24 jam
      if (!cur.enabled && cur.offAt && !GONE.test(cur.offReason || "") && Date.now() - cur.offAt > REVIVE_MS) {
        cur.enabled = true;
        delete cur.offAt;
        delete cur.offReason;
        added = true;
      }
      continue;
    }
    st[id] = buildSub({ query: g.query, place: g.place, zone: { tz: g.tz, offset: g.offset }, by: g.by });
    added = true;
  }
  if (added) sholatDb.write().catch(() => {});
}

export async function disableSub(chatId) {
  const cur = getSub(chatId);
  if (!cur || !cur.enabled) return false;
  cur.enabled = false;
  await sholatDb.write();
  return true;
}

// ── jadwal harian per lokasi (dipakai bersama oleh semua chat di kota yang sama) ──
const dayCache = new Map(); // "lat,lon" -> { date, r }
const inflight = new Map(); // "lat,lon" -> Promise (hindari request ganda)
const retryAt = new Map(); // chatId -> timestamp boleh coba lagi

async function timesFor(sub, ln) {
  const key = `${sub.place.lat.toFixed(3)},${sub.place.lon.toFixed(3)}`;
  const hit = dayCache.get(key);
  if (hit && hit.date === ln.date) return hit.r;
  // Gabungkan request yang bersamaan untuk lokasi yang sama (mode global = ratusan chat, satu kota)
  let job = inflight.get(key);
  if (!job) {
    job = getTimings(sub.tz ? { ...sub.place, tz: sub.tz } : sub.place, { fresh: true })
      .then((r) => {
        dayCache.set(key, { date: ln.date, r });
        if (dayCache.size > 300) dayCache.delete(dayCache.keys().next().value);
        return r;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

const parseClock = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// ── audio adzan (dikirim tepat di atas Rich Message) ──
const MAX_AUDIO_BYTES = maxBotApiUploadBytes(); // batas upload bot Telegram 
const adzanIds = new Map(); // sumber -> file_id (cache supaya tidak upload ulang tiap waktu sholat)
const adzanFirst = new Map(); // sumber -> Promise upload pertama (chat lain menunggu, lalu pakai file_id)

/** { url } | { file } | null untuk satu waktu sholat; null = tanpa audio */
function adzanSource(key) {
  const c = config.sholat?.adzan;
  if (c === false || c == null) return null;
  const cfg = typeof c === "string" ? { default: c } : c;
  const url = String(cfg[key] || cfg.default || "").trim();
  if (/^https?:\/\//i.test(url)) return { url };
  for (const name of key === "fajr" ? ["adzan-subuh.mp3", "adzan.mp3"] : ["adzan.mp3"]) {
    const file = path.resolve(process.cwd(), "Assets", name);
    if (fs.existsSync(file)) return { file };
  }
  return null;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) throw new Error(`file audio lebih dari ${Math.round(MAX_AUDIO_BYTES / 1048576)} MB`);
  return buf;
}

/** Kirim audio adzan; tidak pernah melempar error (gagal = pengingat tetap dikirim tanpa audio). */
/** Mengembalikan pesan yang terkirim, atau null (tanpa sumber audio / gagal). */
async function sendAdzan(telegram, chatId, sub, prayer, opts = {}) {
  const src = adzanSource(prayer.key);
  if (!src) return null;
  const cfg = config.sholat?.adzan || {};
  const id = src.url || src.file;
  const extra = {
    parse_mode: "HTML",
    caption: opts.caption || `🕋 <b>Adzan ${prayer.name} telah berkumandang</b>\n<i>Sholatlah sebelum kamu disholatkan.</i>`,
    ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    title: String(cfg.title || "Adzan {sholat}").replace("{sholat}", prayer.name),
    performer: String(cfg.performer || "").trim() || config.botName || undefined,
    ...(sub.threadId ? { message_thread_id: sub.threadId } : {}),
  };
  let cached = adzanIds.get(id);
  if (!cached && adzanFirst.has(id)) {
    await adzanFirst.get(id).catch(() => {});
    cached = adzanIds.get(id);
  }
  let release = null;
  if (!cached && !adzanFirst.has(id)) adzanFirst.set(id, new Promise((r) => (release = r)));
  try {
    let m;
    if (cached) m = await telegram.sendAudio(chatId, cached, extra);
    else if (src.url) {
      try {
        m = await telegram.sendAudio(chatId, src.url, extra); // Telegram mengambil langsung dari URL
      } catch (e) {
        if (FATAL_SEND.test(e?.message || "") || RATE_LIMIT.test(e?.message || "")) throw e;
        m = await telegram.sendAudio(chatId, { source: await fetchBuffer(src.url), filename: "adzan.mp3" }, extra);
      }
    } else m = await telegram.sendAudio(chatId, { source: fs.createReadStream(src.file), filename: path.basename(src.file) }, extra);
    if (m?.audio?.file_id && !cached) adzanIds.set(id, m.audio.file_id);
    return m || null;
  } catch (e) {
    if (FATAL_SEND.test(e?.message || "") || MIGRATED.test(e?.message || "") || RATE_LIMIT.test(e?.message || "")) throw e;
    console.warn(`[SHOLAT] audio adzan gagal (${chatId}): ${e?.message}`);
    return null;
  } finally {
    if (release) { adzanFirst.delete(id); release(); }
  }
}

// ── hapus otomatis pesan pengingat 5 menit setelah terkirim (tahan restart: disimpan di database) ──
const DELETE_AFTER_MS = 10 * 60 * 1000;
const DELETE_PER_TICK = 25; // hindari flood limit Telegram saat mode global
const pendingDeletes = () => (sholatDb.data.deletes ||= []);

function scheduleDelete(chatId, messageId) {
  if (!messageId) return;
  pendingDeletes().push({ chatId: String(chatId), id: messageId, at: Date.now() + DELETE_AFTER_MS });
  sholatDb.write().catch(() => {});
}

async function sweepDeletes(telegram) {
  const list = pendingDeletes();
  const now = Date.now();
  const due = list.filter((x) => x.at <= now).slice(0, DELETE_PER_TICK);
  if (!due.length) return;
  sholatDb.data.deletes = list.filter((x) => !due.includes(x));
  for (const x of due) {
    await telegram.deleteMessage(x.chatId, x.id).catch(() => {}); // sudah terhapus / tidak ada hak -> abaikan
    await sleep(60);
  }
  sholatDb.write().catch(() => {});
}

/** Grup yang di-upgrade jadi supergroup mendapat ID baru: pindahkan pengaturan sholat (dan data grup) ke ID baru. */
async function migrateChat(telegram, oldId, err) {
  let newId = err?.response?.parameters?.migrate_to_chat_id || err?.parameters?.migrate_to_chat_id;
  if (!newId) {
    // error dari pengirim Rich Message bisa kehilangan parameter -> tanya Telegram langsung
    await telegram.getChat(oldId).catch((e2) => { newId = e2?.response?.parameters?.migrate_to_chat_id || null; });
  }
  const st = store();
  const old = st[oldId];
  if (!newId) {
    if (old) old.enabled = false; // ID baru tidak diketahui: matikan agar tidak error terus
    sholatDb.write().catch(() => {});
    console.warn(`[SHOLAT] ${oldId} sudah jadi supergroup tapi ID baru tidak diketahui, dimatikan`);
    return;
  }
  newId = String(newId);
  if (old) {
    if (!st[newId]) st[newId] = { ...old, enabled: true, sent: { date: old.sent?.date, keys: [...(old.sent?.keys || [])] } };
    delete st[oldId];
    sholatDb.write().catch(() => {});
  }
  try {
    const groups = groupsDb.data.groups || {};
    if (groups[oldId]) {
      if (!groups[newId]) groups[newId] = groups[oldId];
      delete groups[oldId];
      await groupsDb.write();
    }
  } catch { /* abaikan */ }
  console.log(`[SHOLAT] grup ${oldId} -> supergroup ${newId}, pengaturan dipindahkan`);
}

// ── Rich Message yang andal: coba ulang untuk error sementara (jaringan, 5xx, parse); error fatal / rate limit / migrasi langsung dilempar ──
const audioSent = new Set(); // "chat|tanggal|sholat" -> audio sudah terkirim (cegah audio ganda saat teks diulang)
async function sendRichReliable(ctx, blocks, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await sendRichBlocks(ctx, blocks);
    } catch (e) {
      const m = e?.message || "";
      if (FATAL_SEND.test(m) || MIGRATED.test(m) || RATE_LIMIT.test(m)) throw e;
      last = e;
      console.warn(`[SHOLAT] Rich Message ke ${ctx.chat.id} gagal (percobaan ${i + 1}/${tries}): ${m}`);
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

async function processChat(telegram, chatId, sub) {
  if (Date.now() < (retryAt.get(chatId) || 0)) return;
  const zone = { tz: sub.tz, offset: sub.offset };
  const ln = localNow(zone);
  sub.sent ||= { date: ln.date, keys: [] };
  if (sub.sent.date !== ln.date) {
    sub.sent = { date: ln.date, keys: [] };
    sholatDb.write().catch(() => {});
  }

  // cari waktu sholat yang sedang jatuh tempo lebih dulu, supaya tidak memanggil API saat tidak perlu
  let r = null;
  const due = [];
  const cached = dayCache.get(`${sub.place.lat.toFixed(3)},${sub.place.lon.toFixed(3)}`);
  const haveToday = cached && cached.date === ln.date;
  if (!haveToday) {
    if (Date.now() < (retryAt.get(chatId) || 0)) return;
    try {
      r = await timesFor(sub, ln);
    } catch (e) {
      retryAt.set(chatId, Date.now() + RETRY_MS);
      console.error(`[SHOLAT] ambil jadwal ${sub.place.label}: ${e?.message}`);
      return;
    }
  } else {
    r = cached.r;
  }

  for (const p of PRAYERS) {
    if (sub.sent.keys.includes(p.key)) continue;
    const t = parseClock(r.times?.[p.key]);
    if (t == null) continue;
    const late = ln.minutes - t;
    if (late >= 0 && late <= GRACE_MIN) due.push({ p, time: r.times[p.key] });
  }
  if (!due.length) return;

  for (const { p, time } of due) {
    sub.sent.keys.push(p.key); // tandai dulu agar tick berikutnya tidak mengirim ganda
    const info = { prayer: p, place: sub.place, time, ln, zone, methodName: r.methodName, offline: r.offline };
    const sentIds = [];
    const audioKey = `${chatId}|${sub.sent.date}|${p.key}`;
    try {
      await throttle();
      // 1) Audio adzan (caption singkat). Hanya sekali per waktu sholat, walau teks pengingat perlu dicoba ulang.
      if (!audioSent.has(audioKey)) {
        const audioMsg = await sendAdzan(telegram, chatId, sub, p);
        if (audioSent.size > 5000) audioSent.clear();
        audioSent.add(audioKey);
        if (audioMsg?.message_id) scheduleDelete(chatId, audioMsg.message_id);
      }
      // 2) Teks pengingat SELALU berupa Rich Message (dengan retry + cadangan bertingkat di sendRichBlocks)
      const track = (m, d, ...rest) => telegram.callApi(m, d, ...rest).then((res) => { if (res?.message_id) sentIds.push(res.message_id); return res; });
      const tracked = new Proxy(telegram, {
        get: (t, k) => (k === "callApi" ? track : typeof t[k] === "function" ? async (...a) => {
          const res = await t[k](...a);
          if (res?.message_id) sentIds.push(res.message_id);
          return res;
        } : t[k]),
      });
      const blocks = reminderBlocks(info);
      const fakeCtx = { telegram: tracked, chat: { id: chatId }, message: sub.threadId ? { is_topic_message: true, message_thread_id: sub.threadId } : {} };
      await sendRichReliable(fakeCtx, blocks);
      for (const id of sentIds) scheduleDelete(chatId, id);
      sholatDb.write().catch(() => {});
    } catch (e) {
      sub.sent.keys = sub.sent.keys.filter((k) => k !== p.key);
      if (MIGRATED.test(e?.message || "")) {
        await migrateChat(telegram, String(chatId), e);
        return;
      }
      if (RATE_LIMIT.test(e?.message || "")) {
        notePause(e); // kunci sudah dilepas di atas -> dicoba lagi di tick berikutnya (masih dalam GRACE_MIN)
        return;
      }
      if (NO_PERM.test(e?.message || "")) {
        retryAt.set(chatId, Date.now() + NO_PERM_RETRY_MS);
        console.warn(`[SHOLAT] ${chatId} tidak boleh kirim pesan (${e.message}), dicoba lagi 3 jam`);
        return;
      }
      if (FATAL_SEND.test(e?.message || "")) {
        sub.enabled = false;
        sub.offAt = Date.now();
        sub.offReason = String(e.message).slice(0, 120);
        sholatDb.write().catch(() => {});
        console.warn(`[SHOLAT] ${chatId} dimatikan otomatis: ${e.message}`);
        return;
      }
      console.error(`[SHOLAT] gagal kirim ke ${chatId}: ${e?.message}`);
    }
  }
}

const busy = new Set();

async function tick(telegram) {
  syncGlobalTargets();
  sweepDeletes(telegram).catch((e) => console.error("[SHOLAT] hapus pesan:", e?.message));
  for (const [chatId, sub] of Object.entries(store())) {
    if (!sub?.enabled || !sub.place || busy.has(chatId)) continue;
    busy.add(chatId);
    processChat(telegram, chatId, sub)
      .catch((e) => console.error("[SHOLAT] tick:", e))
      .finally(() => busy.delete(chatId));
  }
}

/** Dipanggil sekali dari index.js setelah bot aktif */
export function startSholatReminder(telegram) {
  if (globalThis.__sholatTimer) clearInterval(globalThis.__sholatTimer);
  globalThis.__sholatTimer = setInterval(() => tick(telegram).catch((e) => console.error("[SHOLAT] tick:", e)), TICK_MS);
  globalThis.__sholatTimer.unref?.();
  tick(telegram).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────
// mtproto.js — klien GramJS (MTProto), HANYA untuk transfer file besar.
//
// Bot API (Telegraf) dibatasi: kirim maks 50 MB, unduh maks 20 MB.
// MTProto tidak punya batas itu (sampai ~2 GB) dan tidak perlu Local Bot API Server / apiRoot.
// Login sebagai BOT (botAuthToken) memakai token yang sama dengan Telegraf, jadi tidak butuh OTP.
// Koneksi dibuka malas (lazy) saat pertama kali dibutuhkan. Hanya untuk chat PRIBADI.
//
// Syarat: config.mtproto.apiId + apiHash (https://my.telegram.org) atau env API_ID / API_HASH.
// ─────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import config from "../../config.js";
import { mtprotoConfigured } from "./net.js";

const require = createRequire(import.meta.url);
const SESSION_FILE = path.join(process.cwd(), "database", "mtproto.session");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { mtprotoConfigured };
export const mtprotoEnabled = mtprotoConfigured;

let lib = null; // { TelegramClient, StringSession, Api, CustomFile, bigInt }
function loadLib() {
  if (lib) return lib;
  try {
    const tg = require("telegram");
    lib = {
      TelegramClient: tg.TelegramClient,
      Api: tg.Api,
      StringSession: require("telegram/sessions").StringSession,
      CustomFile: require("telegram/client/uploads").CustomFile,
      bigInt: require("big-integer"),
    };
    return lib;
  } catch (e) {
    throw new Error(`Paket GramJS belum terpasang (${e.message}). Jalankan: npm install`);
  }
}

const readSession = () => { try { return fs.readFileSync(SESSION_FILE, "utf8").trim(); } catch { return ""; } };
const saveSession = (str) => { try { fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true }); fs.writeFileSync(SESSION_FILE, str); } catch {} };

const CLIENT_OPTS = { connectionRetries: 10, retryDelay: 2000, downloadRetries: 5, requestRetries: 5, floodSleepThreshold: 60 };

let client = null;
let readyPromise = null;

async function connect(sessionStr) {
  const { TelegramClient, StringSession } = loadLib();
  const c = config.mtproto || {};
  const apiId = Number(process.env.API_ID || c.apiId);
  const apiHash = String(process.env.API_HASH || c.apiHash || "").trim();
  client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, CLIENT_OPTS);
  try { client.setLogLevel("error"); } catch {}
  await client.start({ botAuthToken: config.botToken, onError: (e) => console.error("[MTPROTO] error:", e.message) });
  saveSession(client.session.save());
}

/** Pastikan klien sudah login sebagai bot (aman dipanggil berulang). */
export async function ensureConnected() {
  if (!mtprotoConfigured()) throw new Error("GramJS belum aktif: isi config.mtproto.apiId & apiHash (atau env API_ID / API_HASH).");
  if (client?.connected && !readyPromise) return client;
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        await connect(readSession());
      } catch (e) {
        // session lama bentrok / rusak -> login ulang dengan session baru (login bot tidak butuh OTP)
        if (/AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i.test(e?.message || "")) {
          console.warn("[MTPROTO] session bermasalah, login ulang dengan session baru...");
          try { fs.unlinkSync(SESSION_FILE); } catch {}
          await connect("");
        } else throw e;
      }
      console.log("[MTPROTO] ✅ GramJS siap untuk transfer file besar.");
    })();
    readyPromise.then(() => { readyPromise = null; }, () => { readyPromise = null; client = null; });
  }
  await readyPromise;
  return client;
}

async function reconnect() {
  try { await client?.disconnect(); } catch {}
  client = null;
  readyPromise = null;
}

const isNetErr = (e) => /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket|disconnect|not connected/i.test(`${e?.code || ""} ${e?.message || e}`);

async function withRetry(label, fn, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      console.warn(`[MTPROTO] ${label} percobaan ${i}/${tries} gagal: ${e?.message || e}`);
      if (/FILE_PARTS_INVALID|PEER_ID_INVALID|Could not find the input entity/i.test(e?.message || "")) break; // percuma diulang
      if (i < tries) { if (isNetErr(e)) await reconnect(); await sleep(Math.min(3000 * i, 12000)); }
    }
  }
  throw last;
}

/** Peer chat pribadi. Bot boleh memakai access_hash 0 untuk user yang pernah memulai bot. */
async function privatePeer(c, chatId) {
  try { return await c.getInputEntity(chatId); } catch {}
  const { Api, bigInt } = loadLib();
  return new Api.InputPeerUser({ userId: bigInt(String(chatId)), accessHash: bigInt.zero });
}

const stripHtml = (s = "") => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * Kirim file besar ke chat pribadi lewat MTProto.
 * source: path file (string) atau Buffer. Selalu dikirim sebagai dokumen.
 */
export async function sendFileMT(chatId, source, filename, caption = "", { workers = Number(process.env.UPLOAD_WORKERS) || 8 } = {}) {
  const { CustomFile } = loadLib();
  let filePath = source, tmp = null;
  if (Buffer.isBuffer(source)) {
    tmp = path.join(os.tmpdir(), `mt_${Date.now()}_${Math.random().toString(36).slice(2)}_${filename || "file"}`.replace(/[^\w.-]/g, "_"));
    fs.writeFileSync(tmp, source);
    filePath = tmp;
  }
  try {
    const size = fs.statSync(filePath).size;
    let useWorkers = workers;
    return await withRetry("kirim file", async () => {
      const c = await ensureConnected();
      const peer = await privatePeer(c, chatId);
      const file = new CustomFile(filename || path.basename(filePath), size, filePath);
      const base = { file, forceDocument: true, workers: useWorkers };
      try {
        return await c.sendFile(peer, { ...base, caption, parseMode: "html" });
      } catch (e) {
        if (/entity|parse|markup|ENTITIES/i.test(e?.message || "") && !isNetErr(e)) {
          return await c.sendFile(peer, { ...base, caption: stripHtml(caption) }); // caption tanpa format
        }
        useWorkers = 1; // percobaan berikutnya: 1 koneksi (lebih stabil di koneksi pas-pasan)
        throw e;
      }
    });
  } finally {
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }
}

/** Unduh lampiran pesan (chat pribadi) ke disk lewat MTProto — tanpa batas 20 MB Bot API. */
export async function downloadMessageFileMT(chatId, messageId, dest) {
  return withRetry("unduh file", async () => {
    const c = await ensureConnected();
    const peer = await privatePeer(c, chatId);
    const [msg] = await c.getMessages(peer, { ids: [messageId] });
    if (!msg || !msg.media) throw new Error("Pesan berisi file tidak ditemukan lewat MTProto");
    await c.downloadMedia(msg, { outputFile: dest });
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error("Hasil unduhan MTProto kosong");
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Daftar member grup (tanpa harus pernah chat / /start).
// Bot API tidak punya "daftar member", tapi MTProto punya (channels.getParticipants) untuk bot yang
// menjadi ADMIN di grup. Dipakai /zombies (akun terhapus) dan /all (tag semua member).
// ─────────────────────────────────────────────────────────────────────────
async function groupPeer(c, chatId) {
  try { return await c.getInputEntity(Number(chatId)); } catch {}
  const { Api, bigInt } = loadLib();
  const s = String(chatId);
  if (s.startsWith("-100")) {
    const channelId = bigInt(s.slice(4));
    try {
      const r = await c.invoke(new Api.channels.GetChannels({ id: [new Api.InputChannel({ channelId, accessHash: bigInt.zero })] }));
      const ch = (r.chats || [])[0];
      if (ch?.accessHash) return new Api.InputPeerChannel({ channelId: ch.id, accessHash: ch.accessHash });
    } catch {}
    return new Api.InputPeerChannel({ channelId, accessHash: bigInt.zero });
  }
  return new Api.InputPeerChat({ chatId: bigInt(s.replace("-", "")) });
}

/**
 * Ambil SEMUA member grup. Mengembalikan [{ id, deleted, bot, admin, name, accessHash }].
 * Melempar Error bila MTProto belum aktif / bot bukan admin (pemanggil jatuh ke daftar yang dicatat bot).
 */
export async function getGroupMembersMT(chatId, { limit = 200000 } = {}) {
  return withRetry("daftar member", async () => {
    const c = await ensureConnected();
    const peer = await groupPeer(c, chatId);
    let list = await c.getParticipants(peer, { limit });
    // Grup besar: Telegram membatasi hasil per permintaan; "aggressive" mencari per huruf supaya lebih lengkap
    let total = list.total ?? list.length;
    if (list.length < total && list.length < limit) {
      try { 
        console.log("[MEMBERS] Menggunakan mode aggressive untuk daftar lengkap");
        list = await c.getParticipants(peer, { limit, aggressive: true }); 
      } catch (e) { console.warn("[MEMBERS] aggressive gagal:", e?.message); }
    }
    const out = [];
    for (const u of list) {
      if (!u || u.id == null) continue;
      const cn = u.participant?.className || u.className || "";
      const isDeleted = Boolean(u.deleted) ||
        u.firstName === "Deleted Account" ||
        u.firstName === "Akun Terhapus" ||
        (!u.firstName && !u.lastName && !u.username && !u.bot);
      out.push({
        id: String(u.id),
        deleted: isDeleted,
        bot: Boolean(u.bot),
        admin: /Creator|Admin/i.test(cn) || Boolean(u.adminRights),
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || (isDeleted ? "Deleted Account" : ""),
        accessHash: u.accessHash ? String(u.accessHash) : null,
      });
    }
    return out;
  }, 2);
}

/**
 * Kirim pesan tag lewat MTProto dengan mention berbasis access_hash (cadangan bila Bot API menolak
 * mention user yang belum pernah dilihat bot). members: [{ id, accessHash }]. Teks polos.
 */
export async function sendTagMT(chatId, headText, members, { replyTo = null } = {}) {
  const { Api, bigInt } = loadLib();
  return withRetry("kirim tag", async () => {
    const c = await ensureConnected();
    const peer = await groupPeer(c, chatId);
    const ZW = "\u200B";
    let message = headText || "";
    const entities = [];
    for (const m of members) {
      const offset = message.length;
      message += ZW;
      entities.push(new Api.InputMessageEntityMentionName({
        offset, length: 1,
        userId: new Api.InputUser({ userId: bigInt(String(m.id)), accessHash: bigInt(String(m.accessHash || "0")) }),
      }));
    }
    return c.sendMessage(peer, { message, formattingEntities: entities, ...(replyTo ? { replyTo } : {}) });
  }, 2);
}

/** Mulai panggilan suara (group call / video chat) di grup lewat MTProto.
 * Bot harus ADMIN dengan hak manage video chats / calls. */
export async function createGroupCallMT(chatId, title = "Voice Chat") {
  const { Api } = loadLib();
  return withRetry("buat panggilan", async () => {
    const c = await ensureConnected();
    const peer = await groupPeer(c, chatId);
    const randomId = Math.floor(Math.random() * 0x7fffffff);
    return await c.invoke(new Api.phone.CreateGroupCall({
      peer,
      randomId,
      title: title || undefined,
    }));
  }, 2);
}

export async function disconnectMT() { try { await client?.disconnect(); } catch {} }
process.once("SIGINT", disconnectMT);
process.once("SIGTERM", disconnectMT);

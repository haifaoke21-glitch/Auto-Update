import fs from "fs";
import path from "path";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

const ROOT = path.join(process.cwd(), "database", "whatsapp-senders");
const sessions = new Map();
const retries = new Map();

const PAIRING_TIMEOUT_MS = 120_000; // kode pairing tidak dipakai 2 menit -> sesi dibatalkan
const MAX_RECONNECT = 5; // batas auto-reconnect berturut-turut
// ── kepemilikan sender: setiap sender milik user Telegram yang menambahkannya ──
// owners.json: { owners: { "<nomor>": "<telegramId>" }, selected: { "<ownerTelegramId>": "<nomor>" } }
const OWNERS_FILE = path.join(ROOT, "owners.json");
let ownerStore = { owners: {}, selected: {} };
try {
  const raw = JSON.parse(fs.readFileSync(OWNERS_FILE, "utf8"));
  ownerStore = { owners: raw.owners || {}, selected: raw.selected || {} };
} catch { /* belum ada */ }
const saveOwners = () => {
  try {
    fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(OWNERS_FILE, JSON.stringify(ownerStore, null, 2)); } catch (e) { console.error("[WA] simpan owners:", e.message); }
};

export const getSenderOwner = (id) => ownerStore.owners[String(id)] || null;
export function setSenderOwner(id, userId) {
  ownerStore.owners[String(id)] = String(userId);
  saveOwners();
}
function forgetSender(id) {
  id = String(id);
  delete ownerStore.owners[id];
  for (const [u, sid] of Object.entries(ownerStore.selected)) if (sid === id) delete ownerStore.selected[u];
  saveOwners();
}

/** Daftar sender yang boleh dilihat user. isBotOwner = lihat semua. */
export function listSendersFor(userId, isBotOwner = false) {
  return listSenders()
    .filter((s) => isBotOwner || getSenderOwner(s.id) === String(userId))
    .map((s) => ({ ...s, owner: getSenderOwner(s.id) }));
}

/** Owner bot memilih sender aktifnya (boleh sender siapa saja). */
export function selectSender(ownerUserId, id) {
  id = String(id);
  if (!sessions.has(id)) return false;
  ownerStore.selected[String(ownerUserId)] = id;
  saveOwners();
  return true;
}
export const getSelectedSenderId = (ownerUserId) => ownerStore.selected[String(ownerUserId)] || null;

/**
 * Sender yang dipakai user saat menjalankan command.
 *  - user biasa : sender miliknya sendiri yang sedang connected
 *  - owner bot  : sender pilihan (/pilihsender) -> sender miliknya -> sender connected mana saja
 * Mengembalikan { id, phone, sock } atau null.
 */
export function resolveSender(userId, isBotOwner = false) {
  const pick = (id) => {
    const e = sessions.get(String(id));
    return e?.connected && e.sock ? { id: String(id), phone: e.phone, sock: e.sock } : null;
  };
  if (isBotOwner) {
    const chosen = getSelectedSenderId(userId);
    if (chosen && pick(chosen)) return pick(chosen);
  }
  for (const [id, e] of sessions) {
    if (e.connected && getSenderOwner(id) === String(userId)) return pick(id);
  }
  if (isBotOwner) {
    for (const [id, e] of sessions) if (e.connected) return pick(id);
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sesi dianggap sudah tertaut kalau pairing pernah berhasil (registered / account terisi). */
const isLinked = (creds) => !!(creds?.registered || creds?.account);

function dropSession(id, removeFiles = false) {
  const entry = sessions.get(id);
  if (entry?.pairTimer) clearTimeout(entry.pairTimer);
  sessions.delete(id);
  retries.delete(id);
  try { entry?.sock?.end?.(undefined); } catch {}
  if (removeFiles) {
    fs.rmSync(sessionDir(id), { recursive: true, force: true });
    forgetSender(id);
  }
}

fs.mkdirSync(ROOT, { recursive: true });

const safeId = (id) => String(id).replace(/[^0-9_-]/g, "_");
const sessionDir = (id) => path.join(ROOT, safeId(id));

export function listSenders() {
  return [...sessions.entries()].map(([id, s]) => ({
    id,
    phone: s.phone || null,
    connected: !!s.connected,
  }));
}

export function getSender(id) {
  return sessions.get(String(id))?.sock || null;
}

export function getFirstConnectedSender() {
  for (const s of sessions.values()) {
    if (s.connected && s.sock) return s.sock;
  }
  return null;
}

export function getSenderByPhone(phone) {
  const normalized = String(phone).replace(/\D/g, "");
  for (const s of sessions.values()) {
    if (String(s.phone || "").replace(/\D/g, "") === normalized && s.connected) return s.sock;
  }
  return null;
}

export async function startSender(id, onPairingCode, onStatus, isReconnect = false) {
  id = String(id);
  const existing = sessions.get(id);
  if (!isReconnect) {
    if (existing?.connected) return { connected: true, phone: existing.phone };
    if (existing?.starting || existing?.reconnecting) return { starting: true };
  }

  const dir = sessionDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined;
    console.warn("[WA] fetchLatestBaileysVersion gagal, pakai versi bawaan (bisa ditolak WA dg kode 405)");
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"), // browser kustom sering ditolak WA saat pairing kode
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  const entry = { sock, connected: false, starting: true, reconnecting: false, phone: null, pairTimer: null };
  sessions.set(id, entry);

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    // abaikan event dari socket lama yang sudah diganti / dihapus
    if (sessions.get(id) !== entry) return;

    if (connection) console.log(`[WA] Sender ${id} connection=${connection}`);
    if (connection === "open") {
      if (entry.pairTimer) clearTimeout(entry.pairTimer);
      retries.delete(id);
      entry.connected = true;
      entry.starting = false;
      entry.reconnecting = false;
      entry.phone = sock.user?.id?.split(":")[0]?.split("@")[0] || null;
      console.log(`[WA] Sender ${id} connected${entry.phone ? `: ${entry.phone}` : ""}`);
      onStatus?.("connected", entry.phone);
    }

    if (connection === "close") {
      entry.connected = false;
      entry.starting = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`[WA] Sender ${id} disconnected (${code ?? "unknown"}) linked=${isLinked(state.creds)} err=${lastDisconnect?.error?.message || "-"}`);
      onStatus?.("disconnected", code);

      // Logout dari HP -> sesi tidak berlaku lagi, hapus total (tidak boleh di-restore).
      if (code === DisconnectReason.loggedOut) {
        dropSession(id, true);
        onStatus?.("loggedout");
        return;
      }

      // Pairing belum selesai (kode belum dimasukkan / kedaluwarsa) -> batalkan, JANGAN minta kode lagi.
      if (!isLinked(state.creds)) {
        dropSession(id, true);
        onStatus?.("expired");
        return;
      }

      // Sesi valid -> reconnect dengan backoff dan batas percobaan.
      const n = (retries.get(id) || 0) + 1;
      retries.set(id, n);
      if (n > MAX_RECONNECT) {
        console.error(`[WA] Sender ${id} berhenti reconnect setelah ${MAX_RECONNECT} percobaan`);
        retries.delete(id);
        return;
      }
      entry.reconnecting = true;
      const delay = Math.min(3000 * 2 ** (n - 1), 60_000);
      setTimeout(() => {
        if (sessions.get(id) !== entry) return;
        startSender(id, undefined, onStatus, true).catch((e) => {
          console.error("[WA] reconnect:", e.message);
        });
      }, delay);
    }
  });

  // Kode pairing hanya diminta SEKALI per percobaan /addsender, tidak pernah saat reconnect.
  if (!isLinked(state.creds) && !isReconnect) {
    try {
      // Tunggu socket benar-benar siap (WA kirim event qr/connecting) sebelum minta kode.
      // Minta kode terlalu cepat = error "Connection Closed".
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => { sock.ev.off("connection.update", h); reject(new Error("Timeout menunggu koneksi ke WhatsApp")); }, 20_000);
        const h = (u) => {
          if (u.qr) { clearTimeout(t); sock.ev.off("connection.update", h); resolve(); }
          if (u.connection === "close") {
            clearTimeout(t); sock.ev.off("connection.update", h);
            const c = u.lastDisconnect?.error?.output?.statusCode;
            reject(new Error(`WhatsApp menutup koneksi (kode ${c ?? "?"}). Update Baileys / cek jaringan VPS.`));
          }
        };
        sock.ev.on("connection.update", h);
      });
      const code = await sock.requestPairingCode(id);
      entry.pairTimer = setTimeout(() => {
        if (sessions.get(id) !== entry || entry.connected || isLinked(state.creds)) return;
        dropSession(id, true);
        onStatus?.("expired");
      }, PAIRING_TIMEOUT_MS);
      onPairingCode?.(code);
    } catch (e) {
      dropSession(id, true);
      onStatus?.("error", e.message);
      throw e;
    }
  }

  return { connected: false, starting: true };
}

export async function removeSender(id) {
  id = String(id);
  const entry = sessions.get(id);
  try { await entry?.sock?.logout(); } catch {}
  dropSession(id, true);
  fs.rmSync(sessionDir(id), { recursive: true, force: true });
  forgetSender(id);
}

export async function restoreSenders() {
  // Dinonaktifkan saat start bot.
  // Fitur WhatsApp (addsender, testfunc, bangb) tetap jalan,
  // tapi koneksi Baileys hanya terjadi saat fitur tersebut dipakai,
  // bukan otomatis saat bot start di panel.
  return;
}

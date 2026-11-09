// Auto hapus server offline (+ user tanpa server) terjadwal — dikontrol lewat /autodelsrv on|off.
// State disimpan di cpanelDb.data.autodel[slot] sehingga tetap aktif setelah bot restart.
import { cpanelDb } from "../../database.js";
import { h } from "./util.js";
import { sendView, note } from "../richUi.js";
import { getPanel, slotName } from "./ptero.js";
import { scanOffline, deleteOffline, reportHtml, running } from "./clearoff.js";

export const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 jam
export const MIN_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
const TICK_MS = 20 * 1000;

const store = () => (cpanelDb.data.autodel ||= {});
export const getAuto = (slot) => store()[String(slot)] || null;

/** "30m" | "2h" | "1d" | "90" (menit) -> ms; null bila tidak valid */
export function parseInterval(raw) {
  const m = String(raw || "").trim().toLowerCase().match(/^(\d+)\s*(m|menit|h|j|jam|d|hari)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "m";
  const mult = /^(h|j|jam)$/.test(unit) ? 3600_000 : /^(d|hari)$/.test(unit) ? 86_400_000 : 60_000;
  return n * mult;
}

export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400), hr = Math.floor((total % 86400) / 3600), mn = Math.floor((total % 3600) / 60), sc = total % 60;
  const parts = [];
  if (d) parts.push(`${d} hari`);
  if (hr) parts.push(`${hr} jam`);
  if (mn) parts.push(`${mn} menit`);
  if (!parts.length) parts.push(`${sc} detik`);
  return parts.join(" ");
}

export async function enableAuto(slot, { chatId, intervalMs }) {
  store()[String(slot)] = { enabled: true, intervalMs, nextRunAt: Date.now() + intervalMs, chatId: String(chatId), warned: false, lastRunAt: null, lastResult: null };
  await cpanelDb.write();
  return getAuto(slot);
}

export async function disableAuto(slot) {
  const cur = getAuto(slot);
  if (!cur) return false;
  cur.enabled = false;
  cur.warned = false;
  await cpanelDb.write();
  return true;
}

async function notify(telegram, chatId, rich) {
  try {
    await sendView(telegram, chatId, rich);
  } catch (e) {
    console.warn("[AUTODEL] gagal kirim notifikasi:", e.message);
  }
}

async function runSlot(telegram, slot, cfg) {
  const name = h(slotName(slot));
  running.add(slot);
  try {
    if (!getPanel(slot)) {
      cfg.enabled = false;
      await notify(telegram, cfg.chatId, note("⚠️", "Auto Delete Server dimatikan", `${name} sudah tidak dikonfigurasi.`));
      return;
    }
    const r = await scanOffline(slot);
    if (r.error) {
      // jangan spam: matikan otomatis bila panel/PLTC bermasalah
      cfg.enabled = false;
      cfg.lastResult = `error: ${r.error}`;
      await notify(telegram, cfg.chatId, note("⚠️", "Auto Delete Server dimatikan", `Gagal memeriksa ${name}:<br>${h(r.error)}<br><br>Perbaiki lalu aktifkan lagi: <code>/autodelsrv on</code>`));
      return;
    }
    if (!r.offline.length && !r.users.length) {
      cfg.lastResult = "bersih (tidak ada server offline)";
      return;
    }
    const res = await deleteOffline(slot, r.offline, r.users);
    cfg.lastResult = `server ${res.srvOk.length}/${r.offline.length}, user ${res.usrOk.length}/${r.users.length}`;
    await notify(telegram, cfg.chatId, reportHtml("AUTO DELETE SERVER OFFLINE", name, res));
  } catch (e) {
    console.error("[AUTODEL]", e);
    cfg.lastResult = `error: ${e.message}`;
  } finally {
    running.delete(slot);
    cfg.lastRunAt = Date.now();
    cfg.nextRunAt = Date.now() + cfg.intervalMs;
    cfg.warned = false;
    cpanelDb.write().catch(() => {});
  }
}

async function tick(telegram) {
  const now = Date.now();
  for (const [slot, cfg] of Object.entries(store())) {
    if (!cfg?.enabled || running.has(slot)) continue;
    if (now >= cfg.nextRunAt) {
      // jalan di background agar slot lain tidak menunggu
      runSlot(telegram, slot, cfg);
      continue;
    }
    // peringatan 1 menit sebelum jalan (hanya bila interval cukup panjang)
    if (!cfg.warned && cfg.intervalMs >= 10 * 60 * 1000 && cfg.nextRunAt - now <= WARN_BEFORE_MS) {
      cfg.warned = true;
      cpanelDb.write().catch(() => {});
      notify(telegram, cfg.chatId, note("⚠️", `Auto Delete Server (${h(slotName(slot))})`, "Berjalan dalam ±1 menit.<br>Server <b>OFFLINE</b> akan dihapus otomatis — nyalakan server yang masih dipakai sekarang."));
    }
  }
}

/** Dipanggil sekali dari index.js setelah bot aktif */
export function startAutoDelSrv(telegram) {
  if (globalThis.__autodelTimer) clearInterval(globalThis.__autodelTimer);
  globalThis.__autodelTimer = setInterval(() => tick(telegram).catch((e) => console.error("[AUTODEL] tick:", e)), TICK_MS);
  globalThis.__autodelTimer.unref?.();
}

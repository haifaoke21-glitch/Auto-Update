// ═══════════════════════════════════════════════════════════════════════
//  AUTO BACKUP DATABASE
//  Setiap ada USER / GRUP / CHANNEL baru tercatat, seluruh database dikemas
//  jadi satu file .zip lalu:
//    1. disimpan di folder database/backup/ (disimpan N terakhir saja), dan
//    2. dikirim sebagai dokumen ke owner bot (atau ke chat khusus di config.backup.chatId).
//
//  Backup memakai data yang ada di memori (bukan membaca file), jadi selalu terbaru.
//  Banyak yang daftar sekaligus -> digabung jadi SATU backup (debounce) supaya tidak spam.
//  Tidak ada data yang dikirim ke pihak lain: tujuan hanya owner / chatId yang kamu isi sendiri.
// ═══════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import zlib from "zlib";
import config from "../../config.js";
import { allDbs, dbEvents, DB_DIR, usersDb, groupsDb, cfdDb } from "../database.js";
import { allOwnerIds } from "../middleware.js";
import { maxBotApiUploadBytes } from "./net.js";

const BACKUP_DIR = path.join(DB_DIR, "backup");
const TG_FILE_LIMIT = maxBotApiUploadBytes(); // batas upload bot Telegram (Bot API)

const cfg = () => ({
  enabled: config.backup?.enabled !== false,
  debounceMs: Math.max(5000, Number(config.backup?.debounceMs ?? 60000)),
  keepLocal: Math.max(1, Number(config.backup?.keepLocal ?? 10)),
  chatId: config.backup?.chatId ? String(config.backup.chatId) : "",
});

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ───────────────────────── ZIP (tanpa dependensi) ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Buffer }] -> Buffer zip (deflate) */
export function makeZip(files, date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // versi minimum
    lh.writeUInt16LE(0x0800, 6); // flag: nama file UTF-8
    lh.writeUInt16LE(8, 8); // metode deflate
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ───────────────────────── Backup ─────────────────────────
function stamp() {
  const tz = config.timezone || config.coin?.timezone || "Asia/Jakarta";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}-${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}`;
}

/** Kemas semua database (dari memori) jadi zip */
export function buildBackupZip() {
  const files = Object.entries(allDbs).map(([name, db]) => ({
    name,
    data: Buffer.from(JSON.stringify(db.data, null, 2), "utf8"),
  }));
  return makeZip(files);
}

function saveLocal(zip, filename, keep) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, filename), zip);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^backup-.*\.zip$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* abaikan */ }
  }
}

const nameOf = (type, id) => {
  if (type === "user") return usersDb.data.users[id]?.name || usersDb.data.users[id]?.username || id;
  if (type === "group") return groupsDb.data.groups[id]?.title || id;
  return cfdDb.data.channels[id]?.title || id;
};

function buildCaption(batch) {
  const icon = { user: "👤", group: "👥", channel: "📢" };
  const label = { user: "User", group: "Grup", channel: "Channel" };
  const lines = [];
  for (const type of ["user", "group", "channel"]) {
    const ids = [...batch[type]];
    if (!ids.length) continue;
    const shown = ids.slice(0, 5).map((id) => {
      const n = nameOf(type, id);
      return n === id ? `• <code>${esc(id)}</code>` : `• ${esc(n)} <code>${esc(id)}</code>`;
    });
    const more = ids.length > 5 ? [`• +${ids.length - 5} lainnya`] : [];
    lines.push(`${icon[type]} <b>${label[type]} baru: ${ids.length}</b>\n${[...shown, ...more].join("\n")}`);
  }
  const totals =
    `Total sekarang → User: <b>${Object.keys(usersDb.data.users).length}</b>, ` +
    `Grup: <b>${Object.keys(groupsDb.data.groups).length}</b>, ` +
    `Channel: <b>${Object.keys(cfdDb.data.channels).length}</b>`;
  let caption = `<tg-emoji emoji-id="5967456680940671207">🗄️</tg-emoji> <b>Auto Backup Database</b>\n\n${lines.join("\n\n")}\n\n${totals}`;
  if (caption.length > 1000) caption = caption.slice(0, 990).replace(/<[^>]*$/, "") + "…"; // batas caption 1024
  return caption;
}

// ───────────────────────── Penjadwal ─────────────────────────
let telegram = null;
let timer = null;
let running = null; // promise backup yang sedang berjalan
let batch = { user: new Set(), group: new Set(), channel: new Set() };

const batchSize = () => batch.user.size + batch.group.size + batch.channel.size;

async function runBackup() {
  const current = batch;
  batch = { user: new Set(), group: new Set(), channel: new Set() };
  if (!current.user.size && !current.group.size && !current.channel.size) return;

  const { keepLocal, chatId } = cfg();
  try {
    const zip = buildBackupZip();
    const filename = `backup-${stamp()}.zip`;
    saveLocal(zip, filename, keepLocal);
    console.log(`[BACKUP] ${filename} (${(zip.length / 1024).toFixed(1)} KB) tersimpan di database/backup/`);

    if (!telegram) return;
    if (zip.length > TG_FILE_LIMIT) {
      console.warn("[BACKUP] File terlalu besar untuk dikirim lewat Telegram, hanya disimpan lokal.");
      return;
    }
    const recipients = chatId ? [chatId] : allOwnerIds();
    const caption = buildCaption(current);
    for (const to of recipients) {
      try {
        await telegram.sendDocument(to, { source: zip, filename }, { caption, parse_mode: "HTML" });
      } catch (err) {
        console.error(`[BACKUP] Gagal kirim ke ${to}:`, err.response?.description || err.message);
      }
    }
  } catch (err) {
    console.error("[BACKUP] Gagal:", err.message);
  }
}

function schedule() {
  if (timer || running) return;
  timer = setTimeout(async () => {
    timer = null;
    running = runBackup().finally(() => {
      running = null;
      if (batchSize() > 0) schedule(); // ada yang baru masuk saat backup berjalan
    });
  }, cfg().debounceMs);
  timer.unref?.();
}

/** Pasang listener & simpan telegram client. Panggil sekali dari index.js setelah bot dibuat. */
export function initBackup(tg) {
  telegram = tg;
  if (!cfg().enabled) {
    console.log("[BACKUP] Auto backup nonaktif (config.backup.enabled = false).");
    return;
  }
  dbEvents.on("new", ({ type, id }) => {
    if (!batch[type]) return;
    batch[type].add(id);
    schedule();
  });
}

/** Dipanggil saat bot dimatikan: kirim backup yang masih menunggu (maks. 8 detik) */
export async function flushBackup() {
  if (!cfg().enabled) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (running) await Promise.race([running, new Promise((r) => setTimeout(r, 8000))]);
  if (batchSize() > 0) await Promise.race([runBackup(), new Promise((r) => setTimeout(r, 8000))]);
}

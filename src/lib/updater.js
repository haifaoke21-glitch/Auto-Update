// Auto update dari repo GitHub.
// Developer cukup push script baru + naikkan "version" di version.json. Semua bot yang memakai script ini
// mengecek repo secara berkala, lalu mengirim pesan ke owner-nya: "ada update, ketik /update".
// config.js, database/, node_modules/, tmp/ TIDAK pernah ditimpa.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import AdmZip from "adm-zip";
import { execFile } from "child_process";
import config from "../../config.js";
import { title, sub, para, quote, note, table, h, sendView } from "./richUi.js";
import { tgHtml, iconBtn } from "./emojiUi.js";

const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "database", "update_state.json");
const BACKUP_DIR = path.join(ROOT, "tmp", "update_backup");
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const ALWAYS_PROTECT = ["config.js", "database", "node_modules", "tmp", ".env", ".git"];

const DEFAULTS = {
  enabled: true,
  repo: "", // "username/nama-repo"
  branch: "main",
  token: "", // kosong untuk repo publik; isi PAT (read-only) untuk repo private
  checkEveryMin: 15,
  apiBase: "https://api.github.com",
  protect: [], // file/folder tambahan yang tidak boleh ditimpa
};

export function getCfg() {
  const c = { ...DEFAULTS, ...(config.autoUpdate || {}) };
  c.repo = String(c.repo || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  c.token = c.token || process.env.GITHUB_TOKEN || "";
  c.checkEveryMin = Math.max(5, Number(c.checkEveryMin) || 15);
  return c;
}
export const isConfigured = () => {
  const c = getCfg();
  return Boolean(c.enabled && REPO_RE.test(c.repo));
};


// ===== state =====
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function writeState(st) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

// ===== versi =====
export function localVersion() {
  for (const f of ["version.json", "package.json"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")).version;
      if (v) return String(v);
    } catch {}
  }
  return "0.0.0";
}
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function headers(c, accept) {
  return {
    "User-Agent": "AzmiStecu-MD-Updater",
    Accept: accept || "application/vnd.github+json",
    ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
  };
}

/** Baca version.json di repo (pakai ETag supaya 304 tidak memakan rate limit GitHub). */
export async function fetchRemote() {
  const c = getCfg();
  if (!isConfigured()) throw new Error("Auto update belum dikonfigurasi (config.js -> autoUpdate.repo).");
  const st = readState();
  const res = await axios.get(`${c.apiBase}/repos/${c.repo}/contents/version.json`, {
    params: { ref: c.branch },
    headers: { ...headers(c, "application/vnd.github.raw+json"), ...(st.etag && st.remote ? { "If-None-Match": st.etag } : {}) },
    timeout: 20000,
    responseType: "text",
    transformResponse: (r) => r,
    validateStatus: () => true,
  });
  if (res.status === 304 && st.remote) return st.remote;
  if (res.status === 404) throw new Error(`version.json tidak ditemukan di ${c.repo} (branch ${c.branch}). Repo private? isi autoUpdate.token.`);
  if (res.status === 401) throw new Error("Token GitHub tidak valid.");
  if (res.status === 403) throw new Error("GitHub menolak akses (rate limit atau token tanpa izin).");
  if (res.status !== 200) throw new Error(`GitHub membalas HTTP ${res.status}.`);
  let j;
  try { j = JSON.parse(res.data); } catch { throw new Error("version.json di repo bukan JSON yang valid."); }
  if (!j.version || !/^v?\d+(\.\d+)*/.test(String(j.version))) throw new Error('version.json harus punya field "version" (mis. "2.6.0").');
  const remote = {
    version: String(j.version),
    date: j.date ? String(j.date) : "",
    changelog: (Array.isArray(j.changelog) ? j.changelog : j.changelog ? [j.changelog] : []).map(String).slice(0, 20),
  };
  st.etag = res.headers.etag || "";
  st.remote = remote;
  writeState(st);
  return remote;
}

export async function checkForUpdate() {
  const remote = await fetchRemote();
  const local = localVersion();
  return { local, remote, hasUpdate: compareVersions(remote.version, local) > 0 };
}

// ===== proses update =====
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const isProtected = (rel, extra) =>
  [...ALWAYS_PROTECT, ...extra].some((p) => {
    const q = p.replace(/\/+$/, "");
    return rel === q || rel.startsWith(q + "/");
  });

function npmInstall() {
  return new Promise((resolve, reject) => {
    execFile(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: ROOT, timeout: 600000, maxBuffer: 20 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error("npm install gagal: " + String(stderr || err.message).split("\n").slice(-4).join(" ").trim()));
      else resolve();
    });
  });
}

let busy = false;
export const isUpdating = () => busy;

/**
 * Unduh repo, timpa file script (kecuali yang diproteksi), hapus file yang sudah dihapus di repo,
 * npm install bila package.json berubah. Gagal di tengah jalan = otomatis dikembalikan seperti semula.
 */
export async function applyUpdate({ force = false } = {}) {
  if (busy) throw new Error("Update sedang berjalan.");
  busy = true;
  const created = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(BACKUP_DIR, stamp);
  const backed = [];
  try {
    const c = getCfg();
    const { local, remote, hasUpdate } = await checkForUpdate();
    if (!hasUpdate && !force) return { status: "uptodate", from: local, to: remote.version };

    const zipRes = await axios.get(`${c.apiBase}/repos/${c.repo}/zipball/${c.branch}`, {
      headers: headers(c), responseType: "arraybuffer", timeout: 180000, maxContentLength: 150 * 1024 * 1024, maxRedirects: 5,
    });
    const zip = new AdmZip(Buffer.from(zipRes.data));
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    if (!entries.length) throw new Error("Zip dari GitHub kosong.");
    const prefix = entries[0].entryName.split("/")[0] + "/";

    const extra = c.protect || [];
    const files = new Map(); // rel -> Buffer
    for (const e of entries) {
      if (!e.entryName.startsWith(prefix)) continue;
      const rel = path.posix.normalize(e.entryName.slice(prefix.length));
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel === ".") continue;
      if (isProtected(rel, extra)) continue;
      const dest = path.resolve(ROOT, rel);
      if (!dest.startsWith(ROOT + path.sep)) continue; // anti zip-slip
      files.set(rel, e.getData());
    }
    // Pengaman: jangan sampai repo salah / kosong menimpa script
    if (!files.has("version.json") || !files.has("index.js") || !files.has("package.json")) {
      throw new Error("Repo tidak berisi script bot yang valid (index.js / package.json / version.json tidak ada).");
    }
    // index.js di repo harus file utama bot (memanggil bot.launch), bukan file lain yang salah ter-upload
    const mainSrc = files.get("index.js").toString("utf8");
    if (!/bot\.launch\s*\(/.test(mainSrc) || !/from\s+["']telegraf["']/.test(mainSrc)) {
      throw new Error("index.js di repo bukan file utama bot (tidak ada bot.launch). Update dibatalkan supaya bot tidak rusak.");
    }

    const st = readState();
    const removed = (st.manifest || []).filter((rel) => !files.has(rel) && !isProtected(rel, extra) && fs.existsSync(path.join(ROOT, rel)));

    const backup = (rel) => {
      const src = path.join(ROOT, rel);
      if (!fs.existsSync(src)) return;
      const dst = path.join(backupRoot, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      backed.push(rel);
    };

    const pkgBefore = fs.existsSync(path.join(ROOT, "package.json")) ? sha(fs.readFileSync(path.join(ROOT, "package.json"))) : "";
    let changed = 0;
    const write = (rel, buf) => {
      const dest = path.join(ROOT, rel);
      const exists = fs.existsSync(dest);
      if (exists && sha(fs.readFileSync(dest)) === sha(buf)) return;
      if (exists) backup(rel); else created.push(rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      changed++;
    };

    for (const [rel, buf] of files) if (rel !== "version.json") write(rel, buf);
    for (const rel of removed) { backup(rel); fs.rmSync(path.join(ROOT, rel), { force: true }); }

    const pkgChanged = sha(files.get("package.json")) !== pkgBefore;
    if (pkgChanged) await npmInstall();

    write("version.json", files.get("version.json")); // terakhir: kalau gagal di atas, versi lokal tidak ikut naik

    writeState({ ...readState(), manifest: [...files.keys()], notified: remote.version, lastUpdate: { from: local, to: remote.version, at: new Date().toISOString() } });

    // simpan hanya 3 backup terakhir
    try {
      const dirs = fs.readdirSync(BACKUP_DIR).sort();
      for (const d of dirs.slice(0, Math.max(0, dirs.length - 3))) fs.rmSync(path.join(BACKUP_DIR, d), { recursive: true, force: true });
    } catch {}

    return { status: "updated", from: local, to: remote.version, changed, removed: removed.length, npm: pkgChanged, changelog: remote.changelog };
  } catch (err) {
    // rollback
    for (const rel of backed) {
      try { fs.copyFileSync(path.join(backupRoot, rel), path.join(ROOT, rel)); } catch {}
    }
    for (const rel of created) { try { fs.rmSync(path.join(ROOT, rel), { force: true }); } catch {} }
    throw err;
  } finally {
    busy = false;
  }
}

// ===== tampilan (Rich Message + TG emoji; pemilik tidak premium -> emoji biasa otomatis) =====
const code = (v) => `<code>${h(v)}</code>`;
const changelogBlock = (list) => (list?.length ? sub("📝", "Yang baru") + para(list.map((l) => `• ${h(l)}`)) : "");
const view = (rich, rows) => ({ rich: tgHtml(rich), rows });

export const updateRows = () => [[iconBtn("⬇️", "Update Sekarang", { callback_data: "upd:go" })]];

export const V = {
  notConfigured: () => view(
    title("❌", "Auto Update Belum Aktif") +
    quote("Isi <code>autoUpdate.repo</code> di <code>config.js</code>, contoh: <code>\"username/nama-repo\"</code>.")
  ),
  cloneLocked: () => view(note("🔒", "Khusus Bot Utama", "Update hanya bisa dilakukan lewat bot utama.")),
  busy: () => view(note("⏳", "Update Sedang Berjalan", "Tunggu sebentar sampai prosesnya selesai.")),
  checking: () => view(
    title("⏳", "Memeriksa Update") +
    quote("Memeriksa dan mengunduh update dari GitHub...")
  ),
  available: ({ local, remote }) => view(
    title("🔔", "Update Tersedia") +
    table(["Info", "Detail"], [
      ["📦 Versi sekarang", code(local)],
      ["🆕 Versi baru", code(remote.version) + (remote.date ? ` (${h(remote.date)})` : "")],
    ]) +
    changelogBlock(remote.changelog) +
    quote("Tekan tombol di bawah atau ketik <code>/update</code> untuk memperbarui script bot ini."),
    updateRows()
  ),
  upToDate: ({ version, repo, branch, hint = false }) => view(
    title("✅", "Sudah Versi Terbaru") +
    table(["Info", "Detail"], [
      ["📦 Versi", code(version)],
      ...(repo ? [["🌐 Repo", code(`${repo}@${branch}`)]] : []),
    ]) +
    (hint ? quote("Pakai <code>/update force</code> untuk memasang ulang paksa.") : "")
  ),
  checkFailed: (msg) => view(title("❌", "Gagal Cek Update") + quote(code(msg))),
  done: (r) => view(
    title("✅", "Update Berhasil") +
    table(["Info", "Detail"], [
      ["📦 Versi", `${code(r.from)} → ${code(r.to)}`],
      ["📄 File diperbarui", `${r.changed} file`],
      ...(r.removed ? [["🗑️ File lama dihapus", `${r.removed} file`]] : []),
      ...(r.npm ? [["🔧 Dependency", "diinstall ulang"]] : []),
    ]) +
    changelogBlock(r.changelog) +
    quote("🔄 Bot restart otomatis...")
  ),
  failed: (msg) => view(
    title("❌", "Update Gagal") +
    quote("File dikembalikan seperti semula.", code(msg))
  ),
  active: (version) => view(
    title("✅", "Update Selesai") +
    table(["Info", "Detail"], [
      ["📦 Versi", code(version)],
      ["🟢 Status", "Bot sudah aktif kembali"],
    ])
  ),
};

/** Simpan "kabari saya setelah bot hidup lagi" untuk chat yang menjalankan /update. */
export function setPendingNotice(chatId, info) {
  writeState({ ...readState(), pendingNotice: { chatId, ...info } });
}

const sendTo = (telegram, chatId, v) => sendView(telegram, chatId, v.rich, v.rows);

/**
 * Jalankan di index.js setelah bot aktif.
 * getOwners: () => array ID owner (bot ini saja; tiap bot memberi tahu owner-nya masing-masing).
 */
export function startUpdateChecker(telegram, getOwners) {
  const st0 = readState();
  if (st0.pendingNotice) {
    const n = st0.pendingNotice;
    delete st0.pendingNotice;
    writeState(st0);
    sendTo(telegram, n.chatId, V.active(localVersion())).catch((e) => console.warn("[UPDATE] gagal kirim info setelah update:", e.message));
  }
  if (!isConfigured()) return;

  const run = async () => {
    try {
      const r = await checkForUpdate();
      if (!r.hasUpdate || isUpdating()) return;
      const st = readState();
      if (st.notified === r.remote.version) return; // satu versi cukup satu kali pemberitahuan
      let sent = 0;
      for (const id of getOwners()) {
        try {
          await sendTo(telegram, id, V.available(r));
          sent++;
        } catch {} // owner belum pernah /start bot
      }
      if (sent) writeState({ ...readState(), notified: r.remote.version });
    } catch (e) {
      console.warn("[UPDATE] cek gagal:", e.message);
    }
  };
  setTimeout(run, 30_000).unref?.();
  setInterval(run, getCfg().checkEveryMin * 60_000).unref?.();
  console.log(`[UPDATE] Auto update aktif (${getCfg().repo}@${getCfg().branch}), cek tiap ${getCfg().checkEveryMin} menit. Versi lokal: ${localVersion()}`);
}

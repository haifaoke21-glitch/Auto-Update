// ============================================================
//  BUILD MENU — tombol "Build Menu" di /start
//   • Build APK : ZIP project Flutter / Android native -> APK lewat GitHub Actions (src/lib/buildmenu/github.js)
//   • Rename    : ganti domain, warna, icon & nama aplikasi di ZIP project Flutter (src/lib/buildmenu/fluttermod.js)
//  Hanya chat pribadi & bot utama. Biaya koin: config.js -> buildMenu (owner gratis).
//  Alur: tombol (callback "bmenu") -> user kirim ZIP (handler dokumen) -> [pilihan / teks] -> hasil dikirim ke chat.
// ============================================================
import fs from "fs";
import path from "path";
import axios from "axios";
import AdmZip from "adm-zip";
import { pipeline } from "stream/promises";
import config from "./config.js";
import { getUser } from "./src/database.js";
import { isOwner } from "./src/middleware.js";
import { spend, refund } from "./src/lib/coin.js";
import { registerCallback } from "./src/lib/callbacks.js";
import { isCloneCtx } from "./src/lib/cloneGuard.js";
import { maxUploadBytes, maxDownloadBytes, maxBotApiUploadBytes, maxBotApiDownloadBytes } from "./src/lib/net.js";
import { mtprotoEnabled, sendFileMT, downloadMessageFileMT } from "./src/lib/mtproto.js";
import { escH } from "./src/lib/util.js";
import { h, title, sub, para, quote, note, table, sendView, editView, editCbView, dropAnim } from "./src/lib/richUi.js";
import * as gh from "./src/lib/buildmenu/github.js";
import * as fm from "./src/lib/buildmenu/fluttermod.js";

// ───────────────────────── konfigurasi ─────────────────────────
const cfg = () => config.buildMenu || {};
const enabled = () => cfg().enabled !== false;
const coinOn = () => config.coin?.enabled !== false;
const buildCost = () => (coinOn() ? Math.max(0, Number(cfg().cost ?? 10) || 0) : 0);
const renameCost = () => (coinOn() ? Math.max(0, Number(cfg().renameCost ?? cfg().cost ?? 10) || 0) : 0);
const costFor = (uid, base) => (isOwner(uid) ? 0 : base);
const timeoutMs = () => Math.max(5, Number(cfg().buildTimeoutMinutes ?? 30)) * 60_000;
const pollMs = () => Math.max(4, Number(cfg().pollSeconds ?? 8)) * 1000;
const SESSION_TTL = 10 * 60_000;
const TMP_DIR = path.join(process.cwd(), "tmp", "build");

/** Batas ukuran ZIP project untuk Build APK: config.buildMenu.maxBuildMB (default 100 MB), tetapi tidak melebihi batas unduh bot
 *  (20 MB lewat Bot API resmi; ~2 GB bila GramJS aktif / Local Bot API Server) */
const maxZipBytes = () => Math.min(maxDownloadBytes(), (Number(cfg().maxBuildMB) > 0 ? Number(cfg().maxBuildMB) : 100) * 1024 * 1024);
const maxRenameBytes = () => Math.min(maxDownloadBytes(), (Number(cfg().maxRenameMB) || 150) * 1024 * 1024);
const mb = (n) => (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1);

const PERF = {
  fast: { label: "⚡ Kencang", desc: "Build tercepat, APK arm64 saja (HP modern)." },
  low: { label: "📱 Low Device", desc: "Mendukung HP lama (arm32 + arm64), build lebih lama." },
};
const MODS = {
  all: { label: "Rename All", icon: "✨", desc: "Ganti domain, warna & icon sekaligus dalam satu proses (bagian yang tidak perlu bisa dilewati)." },
  domain: { label: "Ganti Domain", icon: "🌐", desc: "Ganti URL / domain API di kode (.dart)." },
  color: { label: "Ganti Warna", icon: "🎨", desc: "Ganti warna utama aplikasi (kode, splash & colors.xml)." },
  icon: { label: "Ganti Icon", icon: "🖼️", desc: "Ganti icon launcher Android & iOS dengan gambarmu." },
  name: { label: "Ganti Nama App", icon: "✏️", desc: "Ganti nama aplikasi (AndroidManifest, strings, iOS)." },
};

// ───────────────────────── tombol ─────────────────────────
// ID custom emoji resmi (data/EmojiPrem By @AboutAzmi.js). Kalau pemilik bot utama TIDAK premium,
// premiumEmoji.js otomatis mengembalikan tombol ini ke emoji_fallback biasa — tidak perlu diubah manual di sini.
const BACK = { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙" };
const CLOSE = { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️" };
const btn = (text, data) => ({ text, callback_data: `bmenu:${data}` });
const backRow = (to = "home") => [{ ...BACK, callback_data: `bmenu:${to}` }];
const skipRow = (st) => (st?.mod === "all" ? [[{ text: "Lewati", icon_custom_emoji_id: "5440621591387980068", emoji_fallback: "⏭️", callback_data: "bmenu:sk" }]] : []);
const cancelRow = () => [{ text: "Batalkan", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: "bmenu:x" }];
const homeRows = (uid) => [
  [{ text: "Build APK", icon_custom_emoji_id: "5341715473882955310", emoji_fallback: "🔨", callback_data: "bmenu:apk" }, { text: "Rename", icon_custom_emoji_id: "6204162490515855272", emoji_fallback: "✏️", callback_data: "bmenu:ren" }],
  [{ ...BACK, callback_data: `menu:s:${uid}` }, { ...CLOSE, callback_data: `menu:x:${uid}` }],
];

// ───────────────────────── state ─────────────────────────
const sessions = new Map(); // uid -> { kind:"build"|"mod", step, ..., expires }
const builds = new Map(); // uid -> job build yang sedang berjalan

const rmQuiet = (f) => { if (f) fs.promises.unlink(f).catch(() => {}); };
function clearSession(uid) {
  const s = sessions.get(String(uid));
  if (s) { rmQuiet(s.localZip); sessions.delete(String(uid)); }
}
function setSession(uid, data) {
  clearSession(uid);
  sessions.set(String(uid), { ...data, expires: Date.now() + SESSION_TTL });
}
const getSession = (uid) => {
  const s = sessions.get(String(uid));
  if (!s) return null;
  if (s.expires < Date.now()) { clearSession(uid); return null; }
  return s;
};
const touch = (s) => { s.expires = Date.now() + SESSION_TTL; };
setInterval(() => { for (const [uid, s] of sessions) if (s.expires < Date.now()) clearSession(uid); }, 120_000).unref?.();

const tmpFile = (uid, ext) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return path.join(TMP_DIR, `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
};

// ───────────────────────── util ─────────────────────────
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const bar = (p) => "▰".repeat(Math.round(p / 10)) + "▱".repeat(10 - Math.round(p / 10));
const eng = (e) => (e === "native" ? "native" : "flutter");
const typeLabel = (t) => (t === "debug" ? "🐞 Debug" : "💙 Release");
const profileLabel = (j) => (j.engine === "native" ? "🧩 Native (Gradle)" : PERF[j.perfMode]?.label || PERF.fast.label);
const isPrivate = (ctx) => ctx.chat?.type === "private";

const coinNotice = (telegram, chatId, uid, cost) => {
  if (cost <= 0) return;
  return telegram.sendMessage(
    chatId,
    `<tg-emoji emoji-id="6089104607328342288">💰</tg-emoji> Coin -${escH(cost)}\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin kamu: ${escH(getUser(uid).koin || 0)}`,
    { parse_mode: "HTML" }
  ).catch(() => {});
};
const notEnough = (uid, cost) => `Koin tidak cukup. Butuh ${cost} koin, koin kamu: ${getUser(uid).koin || 0}. Ketik /claim untuk klaim koin gratis.`;
const hasCoin = (uid, cost) => cost <= 0 || (getUser(uid).koin || 0) >= cost;

/** Unduh file Telegram ke disk.
 *  ref = { chatId, messageId, size }: bila file melebihi batas unduh Bot API (20 MB) dan GramJS aktif, diunduh lewat MTProto.
 *  Juga mendukung Local Bot API Server yang mengembalikan path lokal. */
async function downloadTg(telegram, fileId, dest, ref = {}) {
  const canMT = mtprotoEnabled() && ref.chatId && ref.messageId && Number(ref.chatId) > 0;
  if (canMT && (ref.size || 0) > maxBotApiDownloadBytes()) return downloadMessageFileMT(ref.chatId, ref.messageId, dest);
  try {
    return await downloadTgBotApi(telegram, fileId, dest);
  } catch (e) {
    if (canMT && /too big|file is too/i.test(e?.message || "")) return downloadMessageFileMT(ref.chatId, ref.messageId, dest);
    throw e;
  }
}
async function downloadTgBotApi(telegram, fileId, dest) {
  const file = await telegram.getFile(fileId);
  if (file.file_path && path.isAbsolute(file.file_path) && fs.existsSync(file.file_path)) {
    await fs.promises.copyFile(file.file_path, dest);
    return;
  }
  const url = String(await telegram.getFileLink(fileId));
  const res = await axios.get(url, { responseType: "stream", httpsAgent: telegram.options?.agent, timeout: 600_000, maxContentLength: Infinity });
  await pipeline(res.data, fs.createWriteStream(dest));
}

/** Kirim dokumen. Stream selalu ditutup & error-nya ditelan (kalau kirim gagal sebelum stream terbaca, file temp yang dihapus tidak boleh membuat proses crash) */
async function sendDoc(telegram, chatId, source, filename, caption) {
  if (typeof source?.on === "function") source.on("error", () => {});
  // File di atas batas Bot API (49 MB) -> kirim lewat GramJS/MTProto (hanya chat pribadi)
  const size = Buffer.isBuffer(source) ? source.length : source?.path ? fs.statSync(source.path).size : 0;
  if (size > maxBotApiUploadBytes() && mtprotoEnabled() && Number(chatId) > 0) {
    try {
      return await sendFileMT(chatId, Buffer.isBuffer(source) ? source : source.path, filename, caption);
    } finally {
      source?.destroy?.();
    }
  }
  try {
    return await telegram.sendDocument(chatId, { source, filename }, { caption, parse_mode: "HTML" });
  } finally {
    source?.destroy?.();
  }
}

// ───────────────────────── tampilan ─────────────────────────
function costText(uid) {
  if (isOwner(uid)) return "Gratis (owner)";
  const b = buildCost(), r = renameCost();
  return b || r ? `Build APK ${b} koin • Rename ${r} koin` : "Gratis";
}

function homeView(uid) {
  return {
    rich:
      title("🛠️", "Build Menu") +
      para(`Alat build & modifikasi project untuk <b>${h(config.botName)}</b>. Kirim project dalam bentuk <b>ZIP</b>.`) +
      table(["Fitur", "Keterangan"], [
        ["🔨 Build APK", "Compile project <b>Flutter</b> atau <b>Android native</b> (Gradle) jadi APK, dikerjakan di server GitHub Actions"],
        ["✏️ Rename", "Ganti <b>domain</b>, <b>warna</b>, <b>icon</b> & <b>nama aplikasi</b> di project Flutter tanpa buka kodenya"],
        ["💰 Biaya", h(costText(uid))],
        ["📦 Maks ZIP", `${mb(maxZipBytes())} MB`],
      ]) +
      quote("Hanya di chat pribadi bot."),
    rows: homeRows(uid),
  };
}

function renameView() {
  return {
    rich:
      title("✏️", "Rename") +
      para("Pilih yang mau diubah, lalu kirim ZIP project <b>Flutter</b>-mu. Hasilnya dikirim balik sebagai ZIP baru yang siap di-build.") +
      table(["Fitur", "Keterangan"], Object.values(MODS).map((m) => [`${m.icon} ${m.label}`, m.desc])),
    rows: [
      [btn("✨ Rename All", "m:all")],
      [btn("🌐 Rename Domain/URL", "m:domain")],
      [btn("🖼️ Rename Ikon", "m:icon"), btn("🎨 Rename Warna", "m:color")],
      [btn("✏️ Rename Nama App", "m:name")],
      backRow("home"),
    ],
  };
}

const waitingZipView = (st) => {
  const isNative = st.engine === "native";
  return {
    rich:
      title("🔨", `Siap Build ${isNative ? "Native Android" : "Flutter"} APK`) +
      table(["Info", "Detail"], [
        ["📦 Mode", typeLabel(st.buildType)],
        ["⚙️ Profil", h(profileLabel(st))],
        ["✅ Format", "<code>.zip</code>"],
        ["✅ Wajib", isNative ? "<code>settings.gradle</code> + folder <code>app/</code> (disarankan ada <code>gradlew</code>)" : "<code>pubspec.yaml</code>"],
        ["✅ Maks", `<code>${mb(maxZipBytes())} MB</code>`],
      ]) +
      quote(`<i>Kirim file ZIP project ${isNative ? "Android native" : "Flutter"}-mu sekarang.</i>`),
    rows: [cancelRow()],
  };
};

// ───────────────────────── entry: tombol di /start ─────────────────────────
async function editOrSend(ctx, view) {
  const msg = ctx.callbackQuery?.message;
  if (msg && !(msg.photo && !msg.rich_message)) return editCbView(ctx, view.rich, view.rows);
  if (msg) { dropAnim(ctx); await ctx.deleteMessage().catch(() => {}); }
  return sendView(ctx.telegram, ctx.chat.id, view.rich, view.rows);
}

/** Dipanggil dari plugins/main/menu.js (tombol Build Menu di /start) */
export async function showBuildMenu(ctx) {
  const deny = (t) => ctx.answerCbQuery(t, { show_alert: true }).catch(() => {});
  if (isCloneCtx(ctx)) return deny("🔒 Fitur Build Menu hanya bisa dipakai lewat bot utama.");
  if (!enabled()) return deny("Fitur Build Menu sedang dinonaktifkan.");
  if (!isPrivate(ctx)) return deny("🔒 Build Menu hanya bisa dipakai di chat pribadi bot.");
  if (getUser(ctx.from.id).banned && !isOwner(ctx.from.id)) return deny("Akunmu dibanned.");
  clearSession(ctx.from.id);
  await editOrSend(ctx, homeView(ctx.from.id));
  return ctx.answerCbQuery().catch(() => {});
}

// ───────────────────────── callback ─────────────────────────
registerCallback("bmenu", async (ctx, args) => {
  const uid = ctx.from.id;
  const deny = (t) => ctx.answerCbQuery(t, { show_alert: true }).catch(() => {});
  if (isCloneCtx(ctx) || !isPrivate(ctx)) return deny("🔒 Hanya bisa di chat pribadi bot utama.");
  if (!enabled()) return deny("Fitur Build Menu sedang dinonaktifkan.");
  if (getUser(uid).banned && !isOwner(uid)) return deny("Akunmu dibanned.");
  const [act, a, b] = args;
  const show = async (view) => { await editOrSend(ctx, view); return ctx.answerCbQuery().catch(() => {}); };

  if (act === "home") { clearSession(uid); return show(homeView(uid)); }
  if (act === "x") { clearSession(uid); return show(homeView(uid)); }

  // ── hentikan build yang sedang berjalan ──
  if (act === "stop") {
    const job = builds.get(String(uid));
    if (!job) return deny("Tidak ada build yang berjalan.");
    job.cancelled = true;
    return ctx.answerCbQuery("Membatalkan build...").catch(() => {});
  }

  // ── BUILD APK: tipe -> engine -> (profil) -> kirim ZIP ──
  if (act === "apk") {
    if (builds.has(String(uid))) return deny("Masih ada build yang berjalan. Tunggu selesai atau batalkan dulu.");
    return show({
      rich:
        title("🔨", "Build APK") +
        para("Pilih tipe build:") +
        table(["Tipe", "Keterangan"], [["🐞 Debug", "Build cepat untuk testing"], ["💙 Release", "Build untuk produksi"]]),
      rows: [[btn("🐞 Debug", "t:debug"), btn("💙 Release", "t:release")], backRow("home")],
    });
  }
  if (act === "t" && (a === "debug" || a === "release")) {
    return show({
      rich:
        title("🧰", `Pilih Engine (${typeLabel(a)})`) +
        table(["Engine", "Keterangan"], [
          ["🦋 Flutter", "Project Flutter (ada <code>pubspec.yaml</code>) • pilih mode Kencang / Low Device"],
          ["🧩 Native", "Project Android Gradle (Java/Kotlin): <code>settings.gradle</code> + folder <code>app/</code> • tanpa Flutter SDK"],
        ]),
      rows: [[btn("🦋 Flutter", `e:${a}:flutter`), btn("🧩 Native (Gradle)", `e:${a}:native`)], backRow("apk")],
    });
  }
  if (act === "e" && (a === "debug" || a === "release") && (b === "flutter" || b === "native")) {
    if (b === "native") return askBuildZip(ctx, { buildType: a, engine: "native", perfMode: "fast" });
    return show({
      rich:
        title("⚙️", `Pilih Mode Build (${typeLabel(a)})`) +
        table(["Mode", "Keterangan"], [[h(PERF.fast.label), PERF.fast.desc], [h(PERF.low.label), PERF.low.desc]]),
      rows: [[btn(PERF.fast.label, `p:${a}:fast`), btn(PERF.low.label, `p:${a}:low`)], backRow(`t:${a}`)],
    });
  }
  if (act === "p" && (a === "debug" || a === "release") && (b === "fast" || b === "low")) {
    return askBuildZip(ctx, { buildType: a, engine: "flutter", perfMode: b });
  }

  // ── RENAME ──
  if (act === "ren") return show(renameView());
  if (act === "m" && MODS[a]) {
    const cost = costFor(uid, renameCost());
    if (!hasCoin(uid, cost)) return deny(notEnough(uid, cost));
    setSession(uid, { kind: "mod", mod: a, step: "zip" });
    return show({
      rich:
        title(MODS[a].icon, MODS[a].label) +
        para(MODS[a].desc) +
        table(["Info", "Detail"], [["✅ Format", "<code>.zip</code> project Flutter"], ["✅ Maks", `<code>${mb(maxRenameBytes())} MB</code>`], ["💰 Biaya", h(cost ? `${cost} koin` : "Gratis")]]) +
        quote("<i>Kirim file ZIP project Flutter-mu sekarang.</i>"),
      rows: [cancelRow()],
    });
  }
  const st = getSession(uid);
  if (st?.kind === "mod") {
    // Rename All: lewati bagian yang sedang ditanyakan
    if (act === "sk" && st.mod === "all" && ["pickurl", "newurl", "pickcolor", "newcolor", "hex", "icon"].includes(st.step)) {
      await ctx.answerCbQuery("Dilewati.").catch(() => {});
      return advanceAll(ctx.telegram, ctx.chat.id, uid, st);
    }
    // pilih domain lama dari daftar
    if (act === "du" && st.step === "pickurl") {
      const url = st.urls?.[Number(a)]?.[0];
      if (!url) return ctx.answerCbQuery("Pilihan tidak valid.").catch(() => {});
      return askNewUrl(ctx, st, url);
    }
    // pilih warna lama dari daftar
    if (act === "co" && st.step === "pickcolor") {
      const hex = st.colors?.[Number(a)]?.[0];
      if (!hex) return ctx.answerCbQuery("Pilihan tidak valid.").catch(() => {});
      return askNewColor(ctx, st, hex);
    }
    // preset warna baru
    if (act === "cn" && st.step === "newcolor" && fm.COLOR_PRESETS[a]) {
      await ctx.answerCbQuery("Memproses...").catch(() => {});
      return finishColor(ctx.telegram, ctx.chat.id, uid, st, fm.COLOR_PRESETS[a]);
    }
    if (act === "cc" && st.step === "newcolor") {
      st.step = "hex"; touch(st);
      await ctx.answerCbQuery().catch(() => {});
      return sendView(ctx.telegram, ctx.chat.id, note("✏️", "Ketik kode warna", "Kirim kode hex 6 digit, contoh <code>#FF5722</code> atau <code>2196F3</code>."), [cancelRow()]);
    }
  }
  return ctx.answerCbQuery().catch(() => {});
});

async function askBuildZip(ctx, opts) {
  const uid = ctx.from.id;
  if (builds.has(String(uid))) return ctx.answerCbQuery("Masih ada build yang berjalan.", { show_alert: true }).catch(() => {});
  const cost = costFor(uid, buildCost());
  if (!hasCoin(uid, cost)) return ctx.answerCbQuery(notEnough(uid, cost), { show_alert: true }).catch(() => {});
  const st = { kind: "build", step: "zip", ...opts };
  setSession(uid, st);
  const v = waitingZipView(st);
  await editOrSend(ctx, v);
  return ctx.answerCbQuery().catch(() => {});
}

// ───────────────────────── handler pesan (dokumen / foto / teks) ─────────────────────────
const bad = (ctx, text) => sendView(ctx.telegram, ctx.chat.id, note("⚠️", "Perhatian", text), [cancelRow()]);

/** bot.on("document") & bot.on("photo"): ZIP project atau gambar icon */
export async function buildFileHandler(ctx, next) {
  const uid = ctx.from?.id;
  if (!uid || !isPrivate(ctx) || isCloneCtx(ctx)) return next();
  const st = getSession(uid);
  if (!st || !enabled()) return next();
  if ((ctx.message?.caption || "").trim().startsWith("/")) return next(); // command via caption tetap jalan

  if (st.step === "zip") return onZip(ctx, st);
  if (st.step === "icon") return onIcon(ctx, st);
  return next();
}

/** bot.on("text"): URL baru, kode warna, nama aplikasi */
export async function buildTextHandler(ctx, next) {
  const uid = ctx.from?.id;
  if (!uid || !isPrivate(ctx) || isCloneCtx(ctx)) return next();
  const st = getSession(uid);
  if (!st || !enabled()) return next();
  const text = String(ctx.message?.text || "").trim();
  if (/^\/[a-z0-9_]+(@\w+)?(\s|$)/i.test(text)) return next(); // perintah bot tetap berjalan normal
  touch(st);

  if (st.step === "zip") return bad(ctx, "Kirim <b>file ZIP</b>-nya ya, bukan teks.");
  if (st.step === "icon") return bad(ctx, "Kirim <b>gambar</b> icon-nya (foto atau file PNG/JPG).");

  if (st.step === "pickurl") {
    if (!/^https?:\/\/[^\s"'`)]+$/i.test(text)) return bad(ctx, "Pilih URL lama dari tombol, atau ketik URL lengkapnya (contoh <code>https://api.lama.com</code>).");
    return askNewUrl(ctx, st, text.replace(/\/+$/, ""));
  }
  if (st.step === "newurl") {
    if (!/^https?:\/\/[^\s"'`)]+$/i.test(text)) return bad(ctx, "URL tidak valid. Harus diawali <code>http://</code> atau <code>https://</code> tanpa spasi.");
    return finishDomain(ctx.telegram, ctx.chat.id, uid, st, text.replace(/\/+$/, ""));
  }
  if (st.step === "pickcolor") {
    const hex = text.replace(/^#|^0x/i, "");
    if (!fm.isValidHex(hex)) return bad(ctx, "Pilih warna lama dari tombol, atau ketik kode hex 6 digit (contoh <code>#2196F3</code>).");
    return askNewColor(ctx, st, hex.toUpperCase());
  }
  if (st.step === "hex") {
    const hex = text.replace(/^#|^0x/i, "");
    if (!fm.isValidHex(hex)) return bad(ctx, "Kode warna tidak valid. Pakai 6 digit hex, contoh <code>#FF5722</code>.");
    return finishColor(ctx.telegram, ctx.chat.id, uid, st, hex.toUpperCase());
  }
  if (st.step === "name") {
    if (text.length < 1 || text.length > 30 || /[\r\n]/.test(text)) return bad(ctx, "Nama aplikasi harus 1–30 karakter dalam satu baris.");
    return finishName(ctx.telegram, ctx.chat.id, uid, st, text);
  }
  return next();
}

// ───────────────────────── ZIP diterima ─────────────────────────
async function onZip(ctx, st) {
  const uid = ctx.from.id;
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;
  if (!doc) return bad(ctx, "Kirim <b>file ZIP</b>-nya ya, bukan foto/teks. Kirim sebagai <i>file</i> (dokumen).");
  const name = doc.file_name || "project.zip";
  if (!/\.zip$/i.test(name)) return bad(ctx, "File harus berformat <code>.zip</code>. Silakan zip ulang project-mu.");
  const limit = st.kind === "mod" ? maxRenameBytes() : maxZipBytes();
  if (doc.file_size && doc.file_size > limit) {
    return bad(ctx, `File terlalu besar (<code>${mb(doc.file_size)} MB</code>). Maksimal <code>${mb(limit)} MB</code>.`);
  }
  if (st.kind === "build") return startBuild(ctx, st, doc, name);
  return startMod(ctx, st, doc, name);
}

// ═════════════════════════ BUILD APK ═════════════════════════
async function startBuild(ctx, st, doc, fileName) {
  const uid = ctx.from.id;
  const chatId = ctx.chat.id;
  const telegram = ctx.telegram;
  if (builds.has(String(uid))) return bad(ctx, "Masih ada build yang berjalan.");

  const cost = costFor(uid, buildCost());
  if (cost > 0 && !spend(uid, cost)) {
    clearSession(uid);
    return sendView(telegram, chatId, note("💰", "Koin tidak cukup", h(notEnough(uid, cost))), homeRows(uid));
  }
  const worker = gh.pickWorkerRoundRobin();
  if (!worker) {
    if (cost > 0) refund(uid, cost);
    clearSession(uid);
    return sendView(telegram, chatId, note("⚠️", "Belum ada worker GitHub", "Owner belum menambahkan worker GitHub Actions (<code>/addworkergithub</code>). Hubungi admin."), homeRows(uid));
  }

  const { buildType, engine, perfMode } = st;
  clearSession(uid);
  const job = { uid, chatId, buildType, engine: eng(engine), perfMode, fileName, workerId: worker.id, status: "uploading", cost, cancelled: false, started: false, releaseId: null, runId: null };
  builds.set(String(uid), job);

  const modeInfo = [["📄 File", `<code>${h(fileName)}</code>`], ["🔧 Mode", `${typeLabel(buildType)} • ${h(profileLabel(job))}`]];
  const msg = await sendView(telegram, chatId, title("🔄", "Mengunduh File...") + table(["Info", "Detail"], modeInfo), [[btn("❌ Batalkan", "stop")]]);
  const msgId = msg.message_id;
  const ui = { last: "" };
  const show = async (key, rich, rows) => {
    if (ui.last === key) return;
    ui.last = key;
    await editView(telegram, chatId, msgId, rich, rows).catch(() => {});
  };
  const stopRow = [[btn("❌ Batalkan", "stop")]];
  const fail = async (rich, { refundCoin = true } = {}) => {
    if (refundCoin && cost > 0) refund(uid, cost);
    builds.delete(String(uid));
    await show("fail:" + Math.random(), rich + (refundCoin && cost > 0 ? quote(`💰 ${cost} koin dikembalikan.`) : ""), homeRows(uid));
  };

  let localZip = null;
  try {
    localZip = tmpFile(uid, ".zip");
    await downloadTg(telegram, doc.file_id, localZip, { chatId, messageId: ctx.message?.message_id, size: doc.file_size });
    if (job.cancelled) throw Object.assign(new Error("cancel"), { cancelled: true });
    await show("up", title("☁️", "Mengupload ke server build...") + table(["Info", "Detail"], modeInfo), stopRow);

    const tag = `b${uid}-${Date.now().toString(36)}`;
    const { releaseId, browserUrl } = await gh.uploadZipToRelease(worker, localZip, fileName, tag);
    job.releaseId = releaseId;
    rmQuiet(localZip); localZip = null;
    if (job.cancelled) throw Object.assign(new Error("cancel"), { cancelled: true });

    await show("trig", title("🚀", "Memulai build di server...") + table(["Info", "Detail"], [...modeInfo, ["🏷️ Tag", `<code>${tag}</code>`]]), stopRow);
    const runId = await gh.triggerWorkflow(worker, browserUrl, tag, { buildType, perfMode, engine: job.engine });
    job.runId = runId; job.status = "building";
    await monitor({ telegram, chatId, msgId, show, fail, stopRow }, job, worker, modeInfo);
  } catch (err) {
    rmQuiet(localZip);
    gh.deleteRelease(worker, job.releaseId).catch(() => {});
    if (err.cancelled) {
      if (job.runId) gh.cancelRun(worker, job.runId);
      return fail(note("🛑", "Build dibatalkan"), { refundCoin: !job.started });
    }
    console.error("[BUILDMENU] build error:", err.message);
    const net = ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"].includes(err.code);
    const ghMsg = err.response?.data?.message;
    return fail(note("❌", net ? "Koneksi terputus" : "Gagal memproses build", h(net ? "Bot gagal konek ke server. Silakan coba lagi." : ghMsg || err.message)));
  }
}

const wait = async (job, ms) => { for (let t = 0; t < ms && !job.cancelled; t += 1000) await gh.sleep(Math.min(1000, ms - t)); };

async function monitor(ui, job, worker, modeInfo) {
  const { telegram, chatId, show, fail, stopRow } = ui;
  const uid = job.uid;
  const t0 = Date.now();
  const deadline = t0 + timeoutMs();
  let errs = 0;

  const cleanup = () => { gh.deleteRelease(worker, job.releaseId).catch(() => {}); builds.delete(String(uid)); };

  while (true) {
    if (job.cancelled) throw Object.assign(new Error("cancel"), { cancelled: true });
    if (Date.now() > deadline) {
      gh.cancelRun(worker, job.runId);
      cleanup();
      return fail(
        title("🛑", "Build Timeout") + table(["Info", "Detail"], [...modeInfo, ["⏱ Limit", `${Math.round(timeoutMs() / 60000)} menit`]]) + quote("Waktu habis. Cek dependensi project-mu lalu coba lagi."),
        { refundCoin: false }
      );
    }
    let run;
    try {
      run = await gh.getRunStatus(worker, job.runId);
      errs = 0;
    } catch (e) {
      if (++errs >= 6) throw e;
      await wait(job, pollMs());
      continue;
    }
    const elapsed = Math.floor((Date.now() - t0) / 1000);

    if (run.status !== "completed") {
      if (run.status === "in_progress") {
        job.started = true;
        const pct = Math.min(Math.round((elapsed / 300) * 100), 95);
        const step = Math.floor(pct / 5) * 5;
        await show(
          `prog${step}`,
          title("⚡", "Build APK Berjalan") + table(["Info", "Detail"], [...modeInfo, ["📡 Server", "🟡 Compiling"], ["⏱ Waktu", fmtDur(elapsed)]]) + para(`<code>${bar(step)}</code> <b>${step}%</b>`),
          stopRow
        );
      } else {
        await show("queue", title("⏳", "Menunggu Server") + table(["Info", "Detail"], [...modeInfo, ["📡 Server", "🟢 Online"], ["⏱ Waktu", fmtDur(elapsed)]]) + quote("VM sedang disiapkan. Jangan dibatalkan."), stopRow);
      }
      await wait(job, pollMs());
      continue;
    }

    // ── selesai ──
    if (run.conclusion === "success") return deliverApk(ui, job, worker, run, modeInfo, cleanup);
    return reportFailure(ui, job, worker, run, modeInfo, cleanup);
  }
}

async function deliverApk(ui, job, worker, run, modeInfo, cleanup) {
  const { telegram, chatId, show, fail } = ui;
  const uid = job.uid;
  await show("pack", title("📦", "Mengambil APK...") + table(["Info", "Detail"], [...modeInfo, ["⏱ Durasi", fmtDur(run.durationSec)]]) + quote("Kompilasi sukses! Mengambil APK dari cloud..."));
  const zipDest = tmpFile(uid, ".zip");
  let apkPath = null;
  try {
    const arts = await gh.getArtifacts(worker, job.runId);
    const art = arts.find((a) => /apk|build/i.test(a.name)) || arts[0];
    if (!art) { cleanup(); return fail(note("⚠️", "File APK tidak ditemukan", "Kompilasi sukses tapi output APK tidak terdeteksi. Hubungi admin."), { refundCoin: true }); }
    await gh.downloadArtifactZip(worker, art.id, zipDest);
    const zip = new AdmZip(zipDest);
    const entry = zip.getEntries().find((e) => !e.isDirectory && /\.apk$/i.test(e.entryName));
    if (!entry) { cleanup(); return fail(note("⚠️", "APK tidak ada di arsip", "Isi arsip output kosong atau rusak. Hubungi admin."), { refundCoin: true }); }
    apkPath = tmpFile(uid, ".apk");
    fs.writeFileSync(apkPath, entry.getData());
    rmQuiet(zipDest);

    const size = fs.statSync(apkPath).size;
    if (size > maxUploadBytes()) {
      cleanup();
      return fail(note("⚠️", "APK terlalu besar untuk dikirim", `Ukuran APK <code>${mb(size)} MB</code>, batas kirim bot <code>${mb(maxUploadBytes())} MB</code>. Hubungi admin.${mtprotoEnabled() ? "" : "<br><i>Admin: isi config.mtproto (apiId & apiHash) agar bisa kirim file besar.</i>"}`), { refundCoin: true });
    }
    await show("send", title("🚀", "Mengupload APK...") + quote(`APK <code>${mb(size)} MB</code> sedang dikirim ke chat ini...`));
    const base = path.basename(job.fileName, path.extname(job.fileName)).replace(/[^\w.-]+/g, "_").slice(0, 40) || "app";
    await sendDoc(
      telegram, chatId, fs.createReadStream(apkPath), `${base}-${job.buildType}.apk`,
      `<b>APK Siap Digunakan!</b>\n<blockquote>Durasi : <b>${fmtDur(run.durationSec)}</b>\nUkuran : <b>${mb(size)} MB</b>\nMode   : <b>${typeLabel(job.buildType)} • ${h(profileLabel(job))}</b></blockquote>`
    );
    cleanup();
    await show("done", title("✅", "Build Berhasil") + table(["Info", "Detail"], [...modeInfo, ["⏱ Durasi", fmtDur(run.durationSec)], ["💾 Ukuran", `${mb(size)} MB`]]) + quote("APK sudah terkirim di atas."), [[btn("🔨 Build Lagi", "apk"), btn("🏠 Build Menu", "home")]]);
    await coinNotice(telegram, chatId, uid, job.cost);
  } catch (e) {
    cleanup();
    console.error("[BUILDMENU] kirim APK gagal:", e.message);
    await fail(note("❌", "Gagal mengirim APK", h(e.message)), { refundCoin: true });
  } finally {
    rmQuiet(zipDest);
    rmQuiet(apkPath);
  }
}

async function reportFailure(ui, job, worker, run, modeInfo, cleanup) {
  const { telegram, chatId, show } = ui;
  gh.deleteRelease(worker, job.releaseId).catch(() => {});
  await show("failing", title("❌", "Build Gagal") + table(["Info", "Detail"], [...modeInfo, ["📡 Server", "🔴 Failed"]]) + quote("Mengambil log error dari server..."));
  await gh.sleep(3000);
  const d = await Promise.race([gh.getFailedStepLog(worker, job.runId), gh.sleep(30000).then(() => null)]).catch(() => null);
  builds.delete(String(job.uid));

  const rows = [["🔴 Step gagal", `<code>${h(d?.stepName || "Kompilasi utama")}${d?.stepNumber ? ` (#${d.stepNumber})` : ""}</code>`], ...modeInfo, ["⏱ Durasi", fmtDur(run.durationSec)]];
  if (d?.totalLines) rows.push(["📄 Total log", `${d.totalLines} baris`]);
  let rich = title("❌", "Build Gagal") + table(["Info", "Detail"], rows);
  if (d?.locations?.length) rich += sub("📍", "Lokasi error") + quote(d.locations.slice(0, 6).map((l) => `• <code>${h(l.file)}:${l.line}${l.col ? ":" + l.col : ""}</code>`));
  let snippet = "";
  for (const b of d?.errorBlocks || []) {
    const chunk = b.lines.join("\n") + "\n\n";
    if ((snippet + chunk).length > 1500) break;
    snippet += chunk;
  }
  if (snippet) rich += sub("🧾", "Baris error") + `<pre>${h(snippet.trim())}</pre>`;
  rich += quote(d?.fullLog ? "📎 Log lengkap dikirim sebagai file di bawah. Biaya koin tidak dikembalikan karena kegagalan ada di project-mu." : "Gagal mengambil log otomatis dari server. Coba build ulang.");
  await show("failed", rich, [[btn("🔨 Build Lagi", "apk"), btn("🏠 Build Menu", "home")]]);

  if (!d?.fullLog) return;
  try {
    const detail = [
      "BUILD ERROR — DETAIL", `File    : ${job.fileName}`, `Mode    : ${typeLabel(job.buildType)} • ${profileLabel(job)}`,
      `Step    : ${d.stepName}${d.stepNumber ? " (#" + d.stepNumber + ")" : ""}`, `Job     : ${d.jobName || "-"}`, `Durasi  : ${fmtDur(run.durationSec)}`, "",
      "── LOKASI ERROR (file:baris:kolom) ──",
      d.locations.map((l) => `${l.file}:${l.line}${l.col ? ":" + l.col : ""}   (log baris ${l.logLine})`).join("\n") || "(tidak terdeteksi)", "",
      `── BLOK ERROR (${d.errorBlocks.length}) ──`,
      d.errorBlocks.map((b, i) => `#${i + 1}  (log baris ${b.from}–${b.to})\n${b.lines.join("\n")}`).join("\n\n") || "(tidak ada)", "",
      "── 60 BARIS TERAKHIR ──", d.tail.join("\n"), "",
    ].join("\n");
    await sendDoc(telegram, chatId, Buffer.from(detail), "BUILD_ERROR_DETAIL.txt", "📄 <b>Detail Error Build</b>\n<i>Mulai cek dari blok #1.</i>");
    let buf = Buffer.from(d.fullLog);
    let name = "BUILD_FULL_LOG.txt";
    if (buf.length > 8 * 1024 * 1024) {
      const z = new AdmZip();
      z.addFile("BUILD_FULL_LOG.txt", buf);
      buf = z.toBuffer(); name = "BUILD_FULL_LOG.zip";
    }
    if (buf.length <= maxUploadBytes()) await sendDoc(telegram, chatId, buf, name, `🗂 <b>Log Penuh Server</b>\n<i>${d.totalLines} baris.</i>`);
  } catch (e) {
    console.error("[BUILDMENU] kirim log gagal:", e.message);
  }
}

// ═════════════════════════ RENAME ═════════════════════════
async function startMod(ctx, st, doc, fileName) {
  const uid = ctx.from.id;
  const chatId = ctx.chat.id;
  const telegram = ctx.telegram;
  const msg = await sendView(telegram, chatId, note("🔄", "Mengunduh & memindai ZIP...", `<code>${h(fileName)}</code>`));
  const edit = (rich, rows) => editView(telegram, chatId, msg.message_id, rich, rows).catch(() => {});
  const localZip = tmpFile(uid, ".zip");
  try {
    await downloadTg(telegram, doc.file_id, localZip, { chatId, messageId: ctx.message?.message_id, size: doc.file_size });
    // pastikan ZIP valid & project Flutter
    const zip = new AdmZip(localZip);
    if (!zip.getEntries().some((e) => /(^|\/)pubspec\.yaml$/i.test(e.entryName))) {
      rmQuiet(localZip);
      return edit(note("⚠️", "Bukan project Flutter", "Tidak ada <code>pubspec.yaml</code> di dalam ZIP. Pastikan ZIP berisi project Flutter lengkap."), [cancelRow()]);
    }
  } catch (e) {
    rmQuiet(localZip);
    return edit(note("❌", "Gagal membaca ZIP", h(e.message)), [cancelRow()]);
  }
  st.localZip = localZip; st.zipName = fileName; touch(st);

  try {
    if (st.mod === "all") {
      st.urls = fm.scanUrlsInZip(localZip).slice(0, 8);
      st.colors = fm.scanDominantColors(localZip).slice(0, 6);
      const icons = fm.scanIconTargets(localZip).length;
      st.queue = [st.urls.length && "domain", st.colors.length && "color", icons && "icon"].filter(Boolean);
      st.plan = {};
      if (!st.queue.length) return noFind(edit, uid, "Tidak ada domain, warna hex, atau icon standar yang ditemukan di project ini.");
      await edit(title("✨", "Rename All") + table(["Ditemukan", "Jumlah"], [["🌐 Domain/URL", st.urls.length ? `${st.urls.length} domain` : "— (dilewati)"], ["🎨 Warna", st.colors.length ? `${st.colors.length} warna` : "— (dilewati)"], ["🖼️ Icon", icons ? `${icons} file` : "— (dilewati)"]]) + quote("Ikuti langkah berikut. Tekan <b>Lewati</b> untuk bagian yang tidak mau diganti."), [cancelRow()]);
      return advanceAll(telegram, chatId, uid, st);
    }
    if (st.mod === "domain") {
      const urls = fm.scanUrlsInZip(localZip).slice(0, 8);
      st.urls = urls;
      if (!urls.length) return noFind(edit, uid, "Tidak ada URL (http/https) di file .dart project ini.");
      st.step = "pickurl";
      const rows = urls.map(([u, n], i) => [btn(`${u.length > 38 ? u.slice(0, 37) + "…" : u} (${n}×)`, `du:${i}`)]);
      return edit(
        title("🌐", "Ganti Domain") + para("Domain / URL yang ditemukan di kode. Pilih yang mau diganti, atau ketik URL lamanya manual."),
        [...rows, cancelRow()]
      );
    }
    if (st.mod === "color") {
      const colors = fm.scanDominantColors(localZip).slice(0, 6);
      st.colors = colors;
      if (!colors.length) return noFind(edit, uid, "Project ini tidak punya warna hex yang di-hardcode di kode.");
      st.step = "pickcolor";
      const rows = colors.map(([hex, n], i) => [btn(`🎨 #${hex} (${n}×)`, `co:${i}`)]);
      return edit(title("🎨", "Ganti Warna") + para("Warna yang paling sering dipakai di kode. Pilih warna yang mau diganti, atau ketik kode hex-nya manual."), [...rows, cancelRow()]);
    }
    if (st.mod === "icon") {
      const n = fm.scanIconTargets(localZip).length;
      if (!n) return noFind(edit, uid, "Tidak ada icon launcher standar (<code>mipmap-*/ic_launcher.png</code>) di project ini.");
      st.step = "icon";
      return edit(title("🖼️", "Ganti Icon") + para(`Ditemukan <b>${n}</b> file icon. Kirim gambar icon barumu (foto atau file PNG/JPG, disarankan persegi minimal 512×512).`), [cancelRow()]);
    }
    if (st.mod === "name") {
      st.step = "name";
      return edit(title("✏️", "Ganti Nama App") + para("Ketik <b>nama aplikasi</b> yang baru (maks. 30 karakter)."), [cancelRow()]);
    }
  } catch (e) {
    clearSession(uid);
    return edit(note("❌", "Gagal memindai project", h(e.message)), homeRows(uid));
  }
}

function noFind(edit, uid, text) {
  clearSession(uid);
  return edit(note("⚠️", "Tidak ada yang bisa diganti", text), [backRow("ren")]);
}

async function askNewUrl(ctx, st, oldUrl) {
  st.oldUrl = oldUrl; st.step = "newurl"; touch(st);
  await ctx.answerCbQuery?.().catch(() => {});
  return sendView(ctx.telegram, ctx.chat.id,
    title("🌐", "URL Baru") + table(["Info", "Detail"], [["🔻 Lama", `<code>${h(oldUrl)}</code>`]]) + quote("Ketik <b>URL baru</b> (contoh <code>https://api.baru.com</code>)."),
    [...skipRow(st), cancelRow()]);
}

async function askNewColor(ctx, st, oldHex) {
  st.oldHex = oldHex; st.step = "newcolor"; touch(st);
  await ctx.answerCbQuery?.().catch(() => {});
  const keys = Object.keys(fm.COLOR_PRESETS);
  const rows = [];
  for (let i = 0; i < keys.length; i += 3) rows.push(keys.slice(i, i + 3).map((k) => btn(`🎨 ${k[0].toUpperCase() + k.slice(1)}`, `cn:${k}`)));
  rows.push([btn("✏️ Custom Hex", "cc")]);
  rows.push(...skipRow(st), cancelRow());
  return sendView(ctx.telegram, ctx.chat.id,
    title("🎨", "Warna Baru") + table(["Info", "Detail"], [["🔻 Lama", `<code>#${oldHex}</code>`]]) + quote("Pilih warna baru, atau tekan <b>Custom Hex</b>."),
    rows);
}

async function onIcon(ctx, st) {
  const uid = ctx.from.id;
  const m = ctx.message;
  let fileId = null;
  if (m.photo?.length) fileId = m.photo[m.photo.length - 1].file_id;
  else if (m.document && /^image\//i.test(m.document.mime_type || "")) {
    if ((m.document.file_size || 0) > 10 * 1048576) return bad(ctx, "Gambar terlalu besar (maks. 10 MB).");
    fileId = m.document.file_id;
  }
  if (!fileId) return bad(ctx, "Kirim <b>gambar</b> icon-nya (foto atau file PNG/JPG).");
  const imgPath = tmpFile(uid, ".img");
  try {
    await downloadTg(ctx.telegram, fileId, imgPath);
    const buf = fs.readFileSync(imgPath);
    rmQuiet(imgPath);
    if (st.mod === "all") { st.plan.icon = buf; return advanceAll(ctx.telegram, ctx.chat.id, uid, st); }
    return runMod(ctx.telegram, ctx.chat.id, uid, st, {
      label: "Icon", caption: "Icon launcher Android & iOS sudah diperbarui.",
      run: async (out) => {
        const r = await fm.replaceIconInZip(st.localZip, out, buf);
        return { total: r.changedCount, lines: r.changedFiles.map((f) => `• <code>${h(f)}</code>`), summary: [["🖼️ Icon", `${r.changedCount} file diganti`]] };
      },
    });
  } catch (e) {
    rmQuiet(imgPath);
    return bad(ctx, `Gambar tidak bisa dipakai: ${h(e.message)}`);
  }
}

const finishDomain = (tg, chatId, uid, st, newUrl) => st.mod === "all" ? (st.plan.domain = { old: st.oldUrl, neu: newUrl }, advanceAll(tg, chatId, uid, st)) : runMod(tg, chatId, uid, st, {
  label: "Domain", caption: "Domain sudah diganti. Siap dibuild.",
  zeroText: "URL lama tidak ditemukan di file manapun. Pastikan URL-nya sama persis dengan yang ada di kode.",
  run: async (out) => {
    const r = fm.replaceDomainInZip(st.localZip, out, st.oldUrl, newUrl);
    return { total: r.totalOccurrences, lines: r.changedFiles.map((f) => `• <code>${h(f.file)}</code> (${f.count}x)`), summary: [["🔻 Lama", `<code>${h(st.oldUrl)}</code>`], ["🔺 Baru", `<code>${h(newUrl)}</code>`], ["📝 Total", `${r.totalOccurrences}x di ${r.changedFiles.length} file`]] };
  },
});
const finishColor = (tg, chatId, uid, st, newHex) => st.mod === "all" ? (st.plan.color = { old: st.oldHex, neu: newHex }, advanceAll(tg, chatId, uid, st)) : runMod(tg, chatId, uid, st, {
  label: "Warna", caption: "Warna tema + splash sudah diperbarui.",
  zeroText: "Tidak ada file yang berhasil diganti.",
  run: async (out) => {
    const r = fm.replaceColorInZip(st.localZip, out, st.oldHex, newHex);
    return { total: r.totalOccurrences, lines: r.changedFiles.map((f) => `• <code>${h(f.file)}</code> (${f.count}x)`), summary: [["🔻 Lama", `<code>#${st.oldHex}</code>`], ["🔺 Baru", `<code>#${newHex}</code>`], ["📝 Total", `${r.totalOccurrences}x di ${r.changedFiles.length} file`]] };
  },
});
const finishName = (tg, chatId, uid, st, newName) => runMod(tg, chatId, uid, st, {
  label: "Nama App", caption: "Nama aplikasi sudah diperbarui.",
  zeroText: "Nama aplikasi tidak ditemukan di AndroidManifest / strings.xml / build.gradle / Info.plist.",
  run: async (out) => {
    const r = fm.replaceAppNameInZip(st.localZip, out, newName);
    return { total: r.totalOccurrences, lines: r.changedFiles.map((f) => `• <code>${h(f.file)}</code> (${f.count}x)`), summary: [["🔺 Nama baru", `<b>${h(newName)}</b>`], ["📝 Total", `${r.totalOccurrences}x di ${r.changedFiles.length} file`]] };
  },
});

/** Rename All: tanyakan bagian berikutnya (domain -> warna -> icon); setelah semua selesai, jalankan sekaligus */
async function advanceAll(telegram, chatId, uid, st) {
  touch(st);
  const part = st.queue.shift();
  if (part === "domain") {
    st.step = "pickurl";
    const rows = st.urls.map(([u, n], i) => [btn(`${u.length > 38 ? u.slice(0, 37) + "…" : u} (${n}×)`, `du:${i}`)]);
    return sendView(telegram, chatId, title("🌐", "Domain/URL") + para("Pilih domain yang mau diganti, atau ketik URL lamanya manual."), [...rows, ...skipRow(st), cancelRow()]);
  }
  if (part === "color") {
    st.step = "pickcolor";
    const rows = st.colors.map(([hex, n], i) => [btn(`🎨 #${hex} (${n}×)`, `co:${i}`)]);
    return sendView(telegram, chatId, title("🎨", "Warna") + para("Pilih warna yang mau diganti, atau ketik kode hex-nya manual."), [...rows, ...skipRow(st), cancelRow()]);
  }
  if (part === "icon") {
    st.step = "icon";
    return sendView(telegram, chatId, title("🖼️", "Icon") + para("Kirim gambar icon barumu (foto atau file PNG/JPG, disarankan persegi minimal 512×512)."), [...skipRow(st), cancelRow()]);
  }
  // semua bagian sudah ditanyakan
  const { domain, color, icon } = st.plan;
  if (!domain && !color && !icon) {
    clearSession(uid);
    return sendView(telegram, chatId, note("⚠️", "Tidak ada yang diganti", "Semua bagian dilewati."), homeRows(uid));
  }
  st.step = "running";
  return runMod(telegram, chatId, uid, st, {
    label: "Semua", caption: "Domain, warna & icon yang dipilih sudah diganti. Siap dibuild.",
    zeroText: "Tidak ada bagian yang berhasil diganti.",
    run: async (out) => {
      let cur = st.localZip, total = 0;
      const lines = [], summary = [], tmps = [];
      const next = () => { const f = tmpFile(uid, ".zip"); tmps.push(f); return f; };
      try {
        if (domain) {
          const f = next(), r = fm.replaceDomainInZip(cur, f, domain.old, domain.neu);
          if (r.totalOccurrences) { cur = f; total += r.totalOccurrences; lines.push(...r.changedFiles.map((x) => `• <code>${h(x.file)}</code> (${x.count}x)`)); }
          summary.push(["🌐 Domain", r.totalOccurrences ? `<code>${h(domain.old)}</code> → <code>${h(domain.neu)}</code> (${r.totalOccurrences}x)` : "tidak ditemukan"]);
        }
        if (color) {
          const f = next(), r = fm.replaceColorInZip(cur, f, color.old, color.neu);
          if (r.totalOccurrences) { cur = f; total += r.totalOccurrences; lines.push(...r.changedFiles.map((x) => `• <code>${h(x.file)}</code> (${x.count}x)`)); }
          summary.push(["🎨 Warna", r.totalOccurrences ? `<code>#${color.old}</code> → <code>#${color.neu}</code> (${r.totalOccurrences}x)` : "tidak ditemukan"]);
        }
        if (icon) {
          const f = next(), r = await fm.replaceIconInZip(cur, f, icon);
          if (r.changedCount) { cur = f; total += r.changedCount; lines.push(...r.changedFiles.map((x) => `• <code>${h(x)}</code>`)); }
          summary.push(["🖼️ Icon", r.changedCount ? `${r.changedCount} file diganti` : "tidak ditemukan"]);
        }
        if (cur !== st.localZip) fs.copyFileSync(cur, out);
      } finally {
        tmps.forEach(rmQuiet);
      }
      return { total, lines, summary };
    },
  });
}

/** Jalankan satu proses rename: potong koin -> ubah ZIP -> kirim hasil. Koin dikembalikan bila gagal / tidak ada yang berubah. */
async function runMod(telegram, chatId, uid, st, { label, caption, zeroText, run }) {
  const cost = costFor(uid, renameCost());
  if (cost > 0 && !spend(uid, cost)) {
    clearSession(uid);
    return sendView(telegram, chatId, note("💰", "Koin tidak cukup", h(notEnough(uid, cost))), homeRows(uid));
  }
  const msg = await sendView(telegram, chatId, note("⚙️", `Mengganti ${label.toLowerCase()}...`));
  const edit = (rich, rows) => editView(telegram, chatId, msg.message_id, rich, rows).catch(() => {});
  const out = tmpFile(uid, ".zip");
  const zipName = st.zipName || "project.zip";
  try {
    const r = await run(out);
    if (!r.total) {
      refund(uid, cost);
      clearSession(uid);
      return edit(note("⚠️", "Tidak ada perubahan", (zeroText || "Tidak ada yang berhasil diganti.") + (cost ? "<br>💰 Koin dikembalikan." : "")), homeRows(uid));
    }
    const size = fs.statSync(out).size;
    if (size > maxUploadBytes()) {
      refund(uid, cost);
      clearSession(uid);
      return edit(note("⚠️", "Hasil terlalu besar untuk dikirim", `Ukuran <code>${mb(size)} MB</code>, batas kirim bot <code>${mb(maxUploadBytes())} MB</code>.${cost ? "<br>💰 Koin dikembalikan." : ""}`), homeRows(uid));
    }
    const lines = r.lines.slice(0, 15);
    if (r.lines.length > 15) lines.push(`… dan ${r.lines.length - 15} file lain`);
    await edit(
      title("✅", `${label} Berhasil Diganti`) + table(["Info", "Detail"], r.summary) + (lines.length ? quote(lines) : ""),
      [[btn("✏️ Rename Lagi", "ren"), btn("🏠 Build Menu", "home")]]
    );
    await sendDoc(telegram, chatId, fs.createReadStream(out), zipName.replace(/\.zip$/i, "") + `_${label.toLowerCase().replace(/\s+/g, "")}.zip`, `📦 <b>ZIP Hasil Ganti ${h(label)}</b>\n<blockquote>${h(caption)}</blockquote>`);
    await coinNotice(telegram, chatId, uid, cost);
  } catch (e) {
    refund(uid, cost);
    console.error("[BUILDMENU] rename error:", e.message);
    await edit(note("❌", `Gagal mengganti ${label.toLowerCase()}`, h(e.message) + (cost ? "<br>💰 Koin dikembalikan." : "")), homeRows(uid));
  } finally {
    rmQuiet(out);
    clearSession(uid);
  }
}

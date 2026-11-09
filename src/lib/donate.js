// ═══════════════════════════════════════════════════════════════════════
// DONASI — /donate & /leaderboard (kategori Donasi)
//
// Alur:
//   1. /donate            -> Rich Message: foto + nomor DANA / GoPay / OVO / SeaBank (tombol Salin) + cara donasi
//   2. User kirim FOTO bukti transfer di chat pribadi bot (caption = nominal, mis. "25000" / "25rb"; tambah "anonim" kalau mau disamarkan)
//      Kalau caption kosong, bot meminta nominalnya lewat teks.
//   3. Bot membuat ucapan terima kasih (Rich Message + foto bukti tf) ke USER dan ke CHANNEL (config.donate.channelId),
//      lalu menambahkan nominal ke total donasi user -> dipakai /leaderboard.
//   4. Owner menerima salinan bukti + tombol "Batalkan donasi" (untuk bukti palsu).
//      config.donate.requireApproval = true -> donasi baru dihitung & diumumkan setelah owner menekan "Setujui".
//
// Pengaturan: config.js -> donate { photo, methods, channelId, requireApproval, minAmount }.
// Data: database/main/donations.json
// ═══════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";
import config from "../../config.js";
import { donateDb } from "../database.js";
import { allOwnerIds, isOwner } from "../middleware.js";
import { registerCallback } from "./callbacks.js";
import { uploadForFileId } from "./scratch.js";
import { sendRich, h, richTable } from "./rich.js";
import { toLegacy } from "./richUi.js";
import { pick, displayName } from "./util.js";

const FATAL = /forbidden|blocked|chat not found|can't initiate|not enough rights|deactivated/i;
const TTL = 20 * 60 * 1000; // sesi donasi (menunggu bukti / nominal)
const MAX_HISTORY = 3000;

// ───────────────────────── Pengaturan ─────────────────────────
const DEFAULT_METHODS = [
  { name: "DANA", number: "08xxxxxxxxxx", holder: "Nama Pemilik" },
  { name: "GoPay", number: "08xxxxxxxxxx", holder: "Nama Pemilik" },
  { name: "OVO", number: "08xxxxxxxxxx", holder: "Nama Pemilik" },
  { name: "SeaBank", number: "xxxxxxxxxxxx", holder: "Nama Pemilik" },
];
export function donateCfg() {
  const c = config.donate || {};
  const methods = (Array.isArray(c.methods) && c.methods.length ? c.methods : DEFAULT_METHODS).filter((m) => m && m.name && m.number);
  return {
    photo: c.photo || "Assets/donate.jpg",
    methods,
    channelId: c.channelId ? String(c.channelId).trim() : "",
    requireApproval: c.requireApproval === true,
    minAmount: Number.isFinite(Number(c.minAmount)) ? Number(c.minAmount) : 1000,
  };
}

// ───────────────────────── Util ─────────────────────────
export const fmtRp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const fmtTime = (ts) => {
  try {
    return new Intl.DateTimeFormat("id-ID", { timeZone: config.timezone || config.coin?.timezone || "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ts)) + " WIB";
  } catch {
    return new Date(ts).toLocaleString();
  }
};

/** "25000" | "25.000" | "Rp 25.000" | "25rb" | "25k" | "1,5jt" -> angka rupiah (null kalau tidak ada) */
export function parseAmount(raw) {
  const s = String(raw || "").toLowerCase().replace(/rp\.?/g, " ");
  const m = s.match(/(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?(?![a-z\d])/);
  if (!m) return null;
  const num = m[1].replace(/[.,]+$/, "");
  const mult = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 }[m[2]] || 1;
  let val;
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) val = Number(num.replace(/[.,]/g, ""));
  else if (/^\d+[.,]\d{1,2}$/.test(num) && mult > 1) val = Number(num.replace(",", "."));
  else val = Number(num.replace(/[.,]/g, ""));
  val = Math.round(val * mult);
  return Number.isFinite(val) && val > 0 && val <= 1e10 ? val : null;
}
const wantsAnon = (t) => /\b(anonim|anon|anonymous|hamba allah|rahasia)\b/i.test(String(t || ""));
const hasPrefix = (t) => [config.prefix, ...(config.altPrefixes || [])].filter(Boolean).some((p) => String(t || "").trimStart().startsWith(p));

const botUser = (ctx) => ctx.botInfo?.username || "";
const botKey = (ctx) => String(ctx.botInfo?.id ?? ctx.telegram?.token?.split(":")[0] ?? "main");

// ───────────────────────── Database ─────────────────────────
const db = () => {
  const d = donateDb.data;
  d.donors ||= {};
  d.history ||= [];
  d.counter ||= 0;
  return d;
};
const save = () => donateDb.write().catch((e) => console.error("[DONATE] gagal simpan:", e.message));
const findRec = (id) => db().history.find((r) => r.id === Number(id));

/** Daftar donatur terurut: total terbesar dulu (sama -> yang lebih dulu berdonasi) */
export function leaderboardList() {
  return Object.entries(db().donors)
    .filter(([, d]) => d.total > 0)
    .map(([uid, d]) => ({ uid, ...d }))
    .sort((a, b) => b.total - a.total || (a.firstAt || 0) - (b.firstAt || 0));
}
export const rankOf = (uid) => leaderboardList().findIndex((d) => d.uid === String(uid)) + 1;
export const donorName = (d) => (d.anon ? "Anonim" : d.name || "Donatur");

function credit(rec) {
  const d = db();
  const donor = (d.donors[rec.uid] ||= { name: rec.name, username: rec.username, total: 0, count: 0, firstAt: rec.ts });
  donor.name = rec.name;
  donor.username = rec.username;
  donor.anon = rec.anon;
  donor.total += rec.amount;
  donor.count += 1;
  donor.lastAt = rec.ts;
  return donor;
}
function uncredit(rec) {
  const donor = db().donors[rec.uid];
  if (!donor) return;
  donor.total = Math.max(0, donor.total - rec.amount);
  donor.count = Math.max(0, donor.count - 1);
}
function addHistory(rec) {
  const d = db();
  d.history.push(rec);
  while (d.history.length > MAX_HISTORY) {
    const i = d.history.findIndex((r) => r.status !== "pending");
    if (i < 0) break;
    d.history.splice(i, 1);
  }
}

// ───────────────────────── Foto & kirim Rich Message ─────────────────────────
const photoIds = new Map(); // botId -> file_id foto donasi
function donatePhotoPath() {
  const p = path.resolve(process.cwd(), donateCfg().photo);
  if (fs.existsSync(p)) return p;
  const thumb = path.join(process.cwd(), "Assets", "thumb.jpg"); // cadangan: banner menu
  return fs.existsSync(thumb) ? thumb : null;
}
async function ensureDonatePhoto(ctx) {
  const key = botKey(ctx);
  if (photoIds.has(key)) return photoIds.get(key);
  const p = donatePhotoPath();
  if (!p) return null;
  const id = await uploadForFileId(ctx, "photo", { source: fs.readFileSync(p) });
  if (id) photoIds.set(key, id);
  return id;
}

/** Kirim Rich Message + foto (file_id). Gagal rich -> foto + caption HTML -> teks biasa. */
async function sendPhotoRich(telegram, chatId, rich, fileId, extra = {}, markup) {
  const base = { chat_id: chatId, ...extra, ...(markup ? { reply_markup: markup } : {}) };
  if (fileId) {
    try {
      return await telegram.callApi("sendRichMessage", {
        ...base,
        rich_message: { html: `<img src="tg://photo?id=pic"/>${rich}`, media: [{ id: "pic", media: { type: "photo", media: fileId } }] },
      });
    } catch (e) {
      if (FATAL.test(e?.message || "")) throw e;
      console.warn("[DONATE] Rich Message + foto gagal:", e?.message);
    }
    try {
      const legacy = toLegacy(rich);
      const { reply_parameters, message_thread_id } = extra;
      const opt = { parse_mode: "HTML", ...(reply_parameters ? { reply_parameters } : {}), ...(message_thread_id ? { message_thread_id } : {}), ...(markup ? { reply_markup: markup } : {}) };
      if (legacy.length <= 1000) return await telegram.sendPhoto(chatId, fileId, { caption: legacy, ...opt });
      await telegram.sendPhoto(chatId, fileId, { ...(reply_parameters ? { reply_parameters } : {}), ...(message_thread_id ? { message_thread_id } : {}) });
      return await telegram.sendMessage(chatId, legacy, { ...opt, link_preview_options: { is_disabled: true } });
    } catch (e) {
      if (FATAL.test(e?.message || "")) throw e;
      console.warn("[DONATE] foto + caption gagal:", e?.message);
    }
  }
  const { reply_parameters, ...rest } = extra;
  return sendRich(telegram, chatId, { rich, legacy: toLegacy(rich) }, { ...rest, ...(reply_parameters ? { reply_parameters } : {}), ...(markup ? { reply_markup: markup } : {}) });
}

const replyExtra = (ctx) => ({
  ...(ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } } : {}),
  ...(ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
});
const noteHtml = (icon, title, body = "") => `<blockquote>${icon} <b>${title}</b>${body ? "<br>" + body : ""}</blockquote>`;
const replyNote = (ctx, icon, title, body, markup) =>
  sendRich(ctx.telegram, ctx.chat.id, { rich: noteHtml(icon, title, body), legacy: toLegacy(noteHtml(icon, title, body)) }, { ...replyExtra(ctx), ...(markup ? { reply_markup: markup } : {}) });

// ───────────────────────── Sesi donasi ─────────────────────────
const sessions = new Map(); // userId -> { step: "proof" | "amount", fileId?, anon?, exp }
const getSession = (uid) => {
  const s = sessions.get(String(uid));
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(String(uid)); return null; }
  return s;
};

// ───────────────────────── /donate ─────────────────────────
function donateHtml(isPrivate, username) {
  const cfg = donateCfg();
  const rows = cfg.methods.map((m) => [`<b>${h(m.name)}</b>`, `<code>${h(m.number)}</code>`, h(m.holder || "-")]);
  const steps = isPrivate
    ? [
        "1. Transfer ke salah satu nomor di atas (ketuk nomor untuk menyalin).",
        "2. <b>Kirim foto bukti transfer</b> di chat ini.",
        `3. Tulis <b>nominal</b> di caption foto, mis. <code>25000</code> atau <code>25rb</code> (tambah kata <code>anonim</code> bila ingin disamarkan). Tanpa caption, bot akan menanyakan nominalnya.`,
      ]
    : [
        "1. Transfer ke salah satu nomor di atas (ketuk nomor untuk menyalin).",
        `2. Buka chat pribadi bot${username ? ` @${h(username)}` : ""}, ketik /donate, lalu kirim foto bukti transfer.`,
      ];
  return (
    `<h1><tg-emoji emoji-id="6327875261085783004">🎁</tg-emoji> Donasi</h1>` +
    `<p>Terima kasih sudah mau mendukung ${h(config.botName || "bot ini")}. Berapa pun nominalnya sangat berarti dan membantu bot tetap aktif.</p>` +
    `<table bordered striped><tr><th>Metode</th><th>Nomor</th><th>A/N</th></tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>` +
    `<blockquote><b>Cara donasi</b><br>${steps.join("<br>")}</blockquote>` +
    `<p><tg-emoji emoji-id="6156436440260549720">🏆</tg-emoji> Lihat donatur teratas dengan /leaderboard</p>`
  );
}

function donateKeyboard(ctx, isPrivate) {
  const cfg = donateCfg();
  const rows = [];
  for (let i = 0; i < cfg.methods.length; i += 2) {
    rows.push(cfg.methods.slice(i, i + 2).map((m) => ({ text: `📋 Salin ${m.name}`.slice(0, 40), copy_text: { text: String(m.number).slice(0, 256) } })));
  }
  if (isPrivate) rows.push([{ text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: `donate:cancel:${ctx.from.id}` }]);
  else if (botUser(ctx)) rows.push([{ text: "Kirim Bukti di Chat Pribadi", icon_custom_emoji_id: "5443038326535759644", emoji_fallback: "💬", url: `https://t.me/${botUser(ctx)}` }]);
  return { inline_keyboard: rows };
}

export async function showDonate(ctx) {
  const isPrivate = ctx.chat.type === "private";
  if (isPrivate) sessions.set(String(ctx.from.id), { step: "proof", exp: Date.now() + TTL });
  const fileId = await ensureDonatePhoto(ctx).catch(() => null);
  const html = donateHtml(isPrivate, botUser(ctx));
  const markup = donateKeyboard(ctx, isPrivate);
  try {
    return await sendPhotoRich(ctx.telegram, ctx.chat.id, html, fileId, replyExtra(ctx), markup);
  } catch (e) {
    // tombol copy_text ditolak server lama -> kirim tanpa tombol salin
    console.warn("[DONATE] kirim /donate gagal, coba tanpa tombol:", e?.message);
    const plain = { inline_keyboard: markup.inline_keyboard.filter((r) => r.some((b) => !b.copy_text)) };
    return sendPhotoRich(ctx.telegram, ctx.chat.id, html, fileId, replyExtra(ctx), plain.inline_keyboard.length ? plain : undefined);
  }
}

// ───────────────────────── Bukti transfer masuk ─────────────────────────
const waitingAmountHtml = () =>
  noteHtml("<tg-emoji emoji-id=\"6089104607328342288\">💰</tg-emoji>", "Berapa nominal donasimu?", "Ketik angkanya, mis. <code>25000</code> atau <code>25rb</code>. Tambah kata <code>anonim</code> bila ingin disamarkan. Ketik <code>batal</code> untuk membatalkan.");

/** bot.on("photo"): bukti transfer dari user yang sedang dalam sesi /donate */
export async function donateProofHandler(ctx, next) {
  try {
    if (ctx.chat?.type !== "private") return next();
    const s = getSession(ctx.from?.id);
    const caption = ctx.message?.caption || "";
    if (!s || s.step !== "proof" || hasPrefix(caption)) return next();
    const fileId = ctx.message.photo?.at(-1)?.file_id;
    if (!fileId) return next();
    const anon = wantsAnon(caption);
    const amount = parseAmount(caption);
    if (amount) return await finalize(ctx, { fileId, amount, anon });
    sessions.set(String(ctx.from.id), { step: "amount", fileId, anon, exp: Date.now() + TTL });
    return await replyNote(ctx, "<tg-emoji emoji-id=\"6089104607328342288\">💰</tg-emoji>", "Berapa nominal donasimu?", "Ketik angkanya, mis. <code>25000</code> atau <code>25rb</code>. Tambah kata <code>anonim</code> bila ingin disamarkan. Ketik <code>batal</code> untuk membatalkan.");
  } catch (e) {
    console.error("[DONATE] proof:", e);
    return next();
  }
}

/** bot.on("document"): bukti dikirim sebagai file -> minta dikirim sebagai foto (Rich Message butuh foto) */
export async function donateDocHandler(ctx, next) {
  try {
    if (ctx.chat?.type !== "private") return next();
    const s = getSession(ctx.from?.id);
    if (!s || !/^image\//i.test(ctx.message?.document?.mime_type || "") || hasPrefix(ctx.message?.caption)) return next();
    return await replyNote(ctx, "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>", "Kirim sebagai foto", "Bukti transfer dikirim sebagai <b>foto</b> (bukan file/dokumen) ya, supaya bisa ditampilkan di ucapan terima kasih.");
  } catch (e) {
    console.error("[DONATE] doc:", e);
    return next();
  }
}

/** bot.on("text"): nominal donasi setelah foto bukti diterima */
export async function donateTextHandler(ctx, next) {
  try {
    if (ctx.chat?.type !== "private") return next();
    const s = getSession(ctx.from?.id);
    const text = (ctx.message?.text || "").trim();
    if (!s || s.step !== "amount" || hasPrefix(text)) return next();
    if (/^(batal|cancel)$/i.test(text)) {
      sessions.delete(String(ctx.from.id));
      return await replyNote(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji>", "Donasi dibatalkan", "Kalau berubah pikiran, ketik /donate lagi.");
    }
    const amount = parseAmount(text);
    const min = donateCfg().minAmount;
    if (!amount) return await replyNote(ctx, "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>", "Nominal tidak valid", "Contoh: <code>25000</code>, <code>25.000</code>, atau <code>25rb</code>.");
    if (amount < min) return await replyNote(ctx, "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>", "Nominal terlalu kecil", `Minimal donasi ${h(fmtRp(min))}.`);
    return await finalize(ctx, { fileId: s.fileId, amount, anon: s.anon || wantsAnon(text) });
  } catch (e) {
    console.error("[DONATE] text:", e);
    return next();
  }
}

async function finalize(ctx, { fileId, amount, anon }) {
  const min = donateCfg().minAmount;
  if (amount < min) {
    sessions.set(String(ctx.from.id), { step: "amount", fileId, anon, exp: Date.now() + TTL });
    return replyNote(ctx, "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>", "Nominal terlalu kecil", `Minimal donasi ${h(fmtRp(min))}. Ketik nominal yang benar.`);
  }
  sessions.delete(String(ctx.from.id));
  const d = db();
  const rec = {
    id: ++d.counter, uid: String(ctx.from.id), name: displayName(ctx.from), username: ctx.from.username || "",
    amount, anon: Boolean(anon), ts: Date.now(), fileId, status: "pending",
  };
  addHistory(rec);
  await save();
  if (donateCfg().requireApproval) {
    await replyNote(ctx, "<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji>", "Bukti diterima", `Donasi ${h(fmtRp(amount))} sedang diverifikasi owner. Ucapan terima kasih dikirim setelah disetujui.`);
    return notifyOwners(ctx.telegram, rec, botUser(ctx));
  }
  return approve(ctx.telegram, rec, botUser(ctx));
}

// ───────────────────────── Ucapan terima kasih ─────────────────────────
const USER_LINES = [
  (n, a) => `Donasimu sebesar <b>${a}</b> sudah kami terima. Terima kasih banyak, ${n}! Dukunganmu bikin bot ini terus hidup dan berkembang.`,
  (n, a) => `Wah, makasih banyak ${n}! Donasi <b>${a}</b> darimu benar-benar bikin semangat. Semoga rezekimu makin lancar.`,
  (n, a) => `Halo ${n}, bukti transfer <b>${a}</b> sudah masuk. Terima kasih sudah jadi bagian dari yang mendukung bot ini!`,
  (n, a) => `Sepenuh hati kami ucapkan terima kasih, ${n}, atas donasi <b>${a}</b>. Kebaikanmu sangat berarti.`,
];
const CHANNEL_LINES = [
  (n, a) => `Terima kasih banyak kepada <b>${n}</b> yang sudah berdonasi sebesar <b>${a}</b>! Dukunganmu sangat berarti.`,
  (n, a) => `Satu lagi dukungan masuk! <b>${n}</b> berdonasi <b>${a}</b>. Makasih ya, semoga rezekimu makin lancar.`,
  (n, a) => `Apresiasi untuk <b>${n}</b> atas donasi <b>${a}</b>. Kamu bikin bot ini terus berjalan!`,
  (n, a) => `Terima kasih <b>${n}</b>, donasi <b>${a}</b> sudah kami terima dengan penuh rasa syukur.`,
];

const tagOf = (rec) => (rec.username ? `@${h(rec.username)}` : "");
// Nama + username donatur (anonim: username disembunyikan)
const whoHtml = (rec, forUser) => {
  if (rec.anon && !forUser) return "Anonim";
  return `${h(rec.name)}${tagOf(rec) ? ` (${tagOf(rec)})` : ""}`;
};

function infoTable(rec, donor, rank, forUser) {
  const rows = [
    ["Donatur", whoHtml(rec, forUser)],
    ...(!rec.anon || forUser ? [["Username", tagOf(rec) || "-"]] : []),
    [forUser ? "Nominal" : "Nominal donasi", h(fmtRp(rec.amount))],
    [forUser ? "Total donasimu" : "Total donasi", h(fmtRp(donor.total))],
    ["Peringkat", rank ? `#${rank}` : "-"],
    ["ID Donasi", `#${rec.id}`],
    ["Waktu", h(fmtTime(rec.ts))],
  ];
  return richTable(["Info", "Detail"], rows);
}

const userThanksHtml = (rec, donor, rank) =>
  `<h2><tg-emoji emoji-id="6327875261085783004">🎉</tg-emoji> Terima Kasih!</h2>` +
  `<p>${pick(USER_LINES)(whoHtml(rec, true), h(fmtRp(rec.amount)))}</p>` +
  infoTable(rec, donor, rank, true) +
  `<blockquote>${rec.anon ? "Namamu ditampilkan sebagai <b>Anonim</b> di channel dan /leaderboard." : "Namamu tampil di channel dan /leaderboard."}<br><tg-emoji emoji-id="6156436440260549720">🏆</tg-emoji> Cek peringkatmu dengan /leaderboard</blockquote>`;

const channelThanksHtml = (rec, donor, rank, username) =>
  `<h2><tg-emoji emoji-id="4956269706987177066">💝</tg-emoji> Donasi Baru</h2>` +
  `<p>${pick(CHANNEL_LINES)(whoHtml(rec, false), h(fmtRp(rec.amount)))}</p>` +
  infoTable({ ...rec }, donor, rank, false) +
  (username ? `<p>Ingin ikut mendukung? Ketik /donate di @${h(username)}</p>` : "");

/** Hitung donasi + kirim ucapan ke user & channel (+ salinan ke owner) */
async function approve(telegram, rec, username) {
  rec.status = "ok";
  const donor = credit(rec);
  await save();
  const rank = rankOf(rec.uid);

  // 1) ke user
  try {
    await sendPhotoRich(telegram, rec.uid, userThanksHtml(rec, donor, rank), rec.fileId);
  } catch (e) {
    console.warn("[DONATE] ucapan ke user gagal:", e?.message);
  }

  // 2) ke channel
  let channelErr = "";
  const ch = donateCfg().channelId;
  if (ch) {
    try {
      const m = await sendPhotoRich(telegram, ch, channelThanksHtml(rec, donor, rank, username), rec.fileId);
      rec.channelMsgId = m?.message_id || null;
      await save();
    } catch (e) {
      channelErr = e?.description || e?.message || "gagal";
      console.warn("[DONATE] ucapan ke channel gagal:", channelErr);
    }
  }
  await notifyOwners(telegram, rec, username, { donor, rank, channelErr, approved: true });
  return rec;
}

// ───────────────────────── Owner ─────────────────────────
function ownerKeyboard(rec) {
  if (rec.status === "pending") {
    return { inline_keyboard: [[{ text: "Setujui", icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "✅", callback_data: `donate:ok:${rec.id}` }, { text: "Tolak", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: `donate:no:${rec.id}` }]] };
  }
  return { inline_keyboard: [[{ text: "Batalkan donasi", icon_custom_emoji_id: "6129486856212979482", emoji_fallback: "🗑️", callback_data: `donate:void:${rec.id}` }]] };
}

async function notifyOwners(telegram, rec, username, { donor, rank, channelErr, approved } = {}) {
  const head = approved ? "<tg-emoji emoji-id=\"4956269706987177066\">💝</tg-emoji> Donasi Baru" : "<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Donasi Menunggu Verifikasi";
  const rows = [
    ["ID Donasi", `#${rec.id}`],
    ["Donatur", `${h(rec.name)}${rec.username ? ` (@${h(rec.username)})` : ""}`],
    ["User ID", `<code>${h(rec.uid)}</code>`],
    ["Nominal", h(fmtRp(rec.amount))],
    ["Tampil sebagai", rec.anon ? "Anonim" : "Nama asli"],
  ];
  if (approved) {
    rows.push(["Total donatur", h(fmtRp(donor.total))], ["Peringkat", rank ? `#${rank}` : "-"]);
    rows.push(["Channel", donateCfg().channelId ? (channelErr ? `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${h(channelErr)}` : "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> terkirim") : "belum diatur (config.donate.channelId)"]);
  }
  const html = `<h2>${head}</h2>${richTable(["Info", "Detail"], rows)}` + (approved ? `<p>Bukti palsu? Tekan <b>Batalkan donasi</b>.</p>` : `<p>Periksa bukti di atas, lalu setujui atau tolak.</p>`);
  for (const owner of allOwnerIds()) {
    try {
      await sendPhotoRich(telegram, owner, html, rec.fileId, {}, ownerKeyboard(rec));
    } catch (e) {
      console.warn(`[DONATE] notif owner ${owner} gagal:`, e?.message);
    }
  }
}

// ───────────────────────── Tombol ─────────────────────────
registerCallback("donate", async (ctx, args) => {
  const [act, ref] = args;
  if (act === "cancel") {
    if (String(ctx.from.id) !== String(ref)) return ctx.answerCbQuery("Ini bukan sesi kamu.", { show_alert: true });
    sessions.delete(String(ctx.from.id));
    await ctx.answerCbQuery("Dibatalkan.").catch(() => {});
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  }
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery("Khusus owner.", { show_alert: true });
  const rec = findRec(ref);
  if (!rec) return ctx.answerCbQuery("Data donasi tidak ditemukan.", { show_alert: true });
  const done = async (text) => {
    await ctx.answerCbQuery(text).catch(() => {});
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await replyNote(ctx, "<tg-emoji emoji-id=\"5231012545799666522\">ℹ️</tg-emoji>", text, `Donasi #${rec.id} • ${h(rec.name)} • ${h(fmtRp(rec.amount))}`).catch(() => {});
  };
  if (act === "ok") {
    if (rec.status !== "pending") return ctx.answerCbQuery(`Sudah diproses (${rec.status}).`, { show_alert: true });
    await approve(ctx.telegram, rec, botUser(ctx));
    return done("Donasi disetujui & diumumkan");
  }
  if (act === "no") {
    if (rec.status !== "pending") return ctx.answerCbQuery(`Sudah diproses (${rec.status}).`, { show_alert: true });
    rec.status = "rejected";
    await save();
    ctx.telegram.sendMessage(rec.uid, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Maaf, bukti donasi #${rec.id} belum bisa diverifikasi. Hubungi owner bila ada kesalahan.`, { parse_mode: "HTML" }).catch(() => {});
    return done("Donasi ditolak");
  }
  if (act === "void") {
    if (rec.status !== "ok") return ctx.answerCbQuery(`Sudah diproses (${rec.status}).`, { show_alert: true });
    rec.status = "void";
    uncredit(rec);
    await save();
    const ch = donateCfg().channelId;
    if (ch && rec.channelMsgId) ctx.telegram.deleteMessage(ch, rec.channelMsgId).catch(() => {});
    return done("Donasi dibatalkan");
  }
  return ctx.answerCbQuery();
});

// ───────────────────────── /leaderboard ─────────────────────────
const MEDAL = ["<tg-emoji emoji-id=\"6156436440260549720\">🥇</tg-emoji>", "🥈", "🥉"];

export function leaderboardHtml(limit, viewerId) {
  const list = leaderboardList();
  if (!list.length) {
    return `<h1><tg-emoji emoji-id="6156436440260549720">🏆</tg-emoji> Leaderboard Donasi</h1>${noteHtml("<tg-emoji emoji-id=\"6327875261085783004\">🎁</tg-emoji>", "Belum ada donasi", "Jadilah yang pertama! Ketik /donate untuk mendukung bot ini.")}`;
  }
  const top = list.slice(0, limit);
  const rows = top.map((d, i) => [MEDAL[i] || String(i + 1), h(donorName(d)), h(fmtRp(d.total))]);
  const total = list.reduce((s, d) => s + d.total, 0);
  const meIdx = viewerId ? list.findIndex((d) => d.uid === String(viewerId)) : -1;
  const mine =
    meIdx < 0
      ? "Kamu belum berdonasi. Ketik /donate untuk ikut mendukung."
      : `Peringkatmu: <b>#${meIdx + 1}</b> • Total donasimu: <b>${h(fmtRp(list[meIdx].total))}</b>`;
  return (
    `<h1><tg-emoji emoji-id="6156436440260549720">🏆</tg-emoji> Leaderboard Donasi</h1>` +
    `<table bordered striped><tr><th>#</th><th>Donatur</th><th>Total</th></tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>` +
    `<blockquote>${mine}<br><tg-emoji emoji-id="6327875261085783004">🎁</tg-emoji> ${list.length} donatur • Terkumpul ${h(fmtRp(total))}</blockquote>`
  );
}

export async function showLeaderboard(ctx, args = []) {
  const n = Math.min(Math.max(parseInt(args[0], 10) || 10, 1), 25);
  const html = leaderboardHtml(n, ctx.from?.id);
  return sendRich(ctx.telegram, ctx.chat.id, { rich: html, legacy: toLegacy(html) }, replyExtra(ctx));
}

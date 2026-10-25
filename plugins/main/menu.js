import fs from "fs";
import sharp from "sharp";
import path from "path";
import config from "../../config.js";
import credits from "../../credits.js";
import { getPluginsByCategory } from "../../src/pluginLoader.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner, isPartner } from "../../src/middleware.js";
import { CLONE_BLOCKED_CATEGORIES, isCloneCtx } from "../../src/lib/cloneGuard.js";
import { canGrant } from "../../src/lib/cpanel/roles.js";
import { usersDb, groupsDb, getUser } from "../../src/database.js";
import { showInstallMenu } from "../../src/lib/installPanel.js";
import { showCpanelHub, replyCpanelHub } from "../../src/lib/cpanel/hub.js";
import { showJadibotMenu } from "../../src/lib/jadibot.js";
import { showBuildMenu } from "../../src/lib/buildmenu/index.js";
import { maxBotApiUploadBytes } from "../../src/lib/net.js";
import { paint, startAnim, stopAnim } from "../../src/lib/btnAnim.js";
import { htmlEmoji } from "../../src/lib/premiumEmoji.js";

const ICON = {
  main: "🏠", owner: "👑", add: "➕", group: "👤", user: "👤", cek: "✨",
  fun: "🎮", game: "🎮", download: "📥", tools: "⚙️", utility: "⚙️", canvas: "🎨", sticker: "🎨", search: "🔍", ai: "🤖",
  cpanel: "💻", cvps: "☁️", rich: "✨", donasi: "🎁", bypass: "🔓",
};
// ID emoji premium (TG emoji) tiap kategori, diambil dari data/EmojiPrem By @AboutAzmi.js.
// Dipakai untuk tombol (icon_custom_emoji_id) DAN judul menu (<tg-emoji>), jadi emoji tidak pernah dobel:
// teks tombol hanya berisi nama kategori, ikonnya murni dari icon_custom_emoji_id.
const ICON_ID = {
  main: "6305157130357839863", owner: "6206096153511990389", add: "6206375377925839184",
  group: "6307777408300753473", user: "6307777408300753473", cek: "5926840845964676881",
  fun: "5812052837047210636", game: "5361741454685256344", download: "6203886371363364022",
  tools: "5341715473882955310", utility: "5341715473882955310", canvas: "6307647373870897360",
  sticker: "6307647373870897360", search: "6206446249181189526", ai: "5287684458881756303",
  cpanel: "5800827025191080510", cvps: "6071154251076208469", rich: "5926840845964676881",
  donasi: "6206027872121918710", bypass: "5296369303661067030",
};
const catEmoji = (c) => ICON[c] || "📂";
/** Emoji kategori sebagai <tg-emoji> (untuk judul / teks). Kategori tanpa ID tetap diproses htmlEmoji. */
const catIconHtml = (c) => (ICON_ID[c] ? `<tg-emoji emoji-id="${ICON_ID[c]}">${catEmoji(c)}</tg-emoji>` : htmlEmoji(catEmoji(c)));
/** Tombol kategori: teks = nama saja, ikon = emoji premium (emoji_fallback = emoji biasa bila pemilik bot tidak premium) */
const catButton = (c, callback_data) => ({
  text: catLabel(c),
  ...(ICON_ID[c] ? { icon_custom_emoji_id: ICON_ID[c], emoji_fallback: catEmoji(c) } : { text: `${catEmoji(c)} ${catLabel(c)}` }),
  callback_data,
});
// Tombol navigasi prev / next: teks hanya kata, ikon dari emoji premium (tidak ada panah ganda)
const PREV_ID = "6206505206197261313";
const NEXT_ID = "6206325217002788818";
const prevBtn = (callback_data, label = "Prev") => ({ text: label, icon_custom_emoji_id: PREV_ID, emoji_fallback: "◀", callback_data });
const nextBtn = (callback_data, label = "Next") => ({ text: label, icon_custom_emoji_id: NEXT_ID, emoji_fallback: "▶", callback_data });
// Nama tampilan kategori (default: nama kategori dengan huruf kapital di awal)
const CAT_LABEL = { cpanel: "Cpanel", cvps: "CVPS", rich: "Rich", donasi: "Donasi" };
const catLabel = (c) => CAT_LABEL[c] || c.charAt(0).toUpperCase() + c.slice(1);
// Banner menu: taruh gambar di Assets/thumb.jpg (relatif ke folder bot).
// Jika file ada, banner ditanam DI DALAM Rich Message (Bot API 10.2+: <img src="tg://photo?id=banner"/>
// + rich_message.media). Perlu server Bot API 10.2 ke atas; bila ditolak otomatis jatuh ke menu tanpa banner.
const BANNER_PATH = path.join(process.cwd(), "Assets", "thumb.jpg");
const hasBanner = () => fs.existsSync(BANNER_PATH);
// file_id Telegram BERLAKU PER BOT (file_id dari bot utama tidak bisa dipakai bot clone),
// jadi cache disimpan per id bot: bot utama & tiap bot clone upload banner sendiri sekali.
const bannerIds = new Map(); // botId -> file_id
const botKey = (ctx) => String(ctx.botInfo?.id ?? ctx.telegram?.token?.split(":")[0] ?? "main");
const getBannerId = (ctx) => bannerIds.get(botKey(ctx)) || null;

/** Upload banner sekali per bot untuk mendapat file_id (pesan foto langsung dihapus lagi) */
async function ensureBannerId(ctx) {
  if (getBannerId(ctx) || !hasBanner()) return getBannerId(ctx);
  try {
    const m = await ctx.replyWithPhoto({ source: fs.createReadStream(BANNER_PATH) });
    const id = m?.photo?.at(-1)?.file_id || null;
    if (id) bannerIds.set(botKey(ctx), id);
    await ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {});
  } catch (err) {
    console.warn("[MENU] Upload banner gagal, menu tanpa banner:", err?.message);
  }
  return getBannerId(ctx);
}

// ===== Audio menu /start (pemutar lagu di dalam Rich Message, di bawah banner) =====
// Sumber lagu lewat URL langsung ke file audio (mp3/m4a), atur di config.js:
//   startAudio: "https://domain.com/lagu.mp3"
//   startAudio: { url: "https://domain.com/lagu.mp3", title: "Nama Lagu", performer: "Artis" }
//   startAudio: false  -> matikan
// Cadangan lokal (tanpa url): file Assets/menu.mp3 atau startAudio: { path: "Assets/lagu.mp3" }.
const MAX_AUDIO_BYTES = maxBotApiUploadBytes(); // batas upload bot Telegram 
function audioCfg() {
  const c = config.startAudio;
  if (c === false) return null;
  if (typeof c === "string") return { url: c.trim() };
  return c && typeof c === "object" ? c : {};
}
const audioUrl = () => String(audioCfg()?.url || "").trim();
const audioPath = () => path.resolve(process.cwd(), audioCfg()?.path || "Assets/menu.mp3");
const hasAudio = () => Boolean(audioCfg()) && (/^https?:\/\//i.test(audioUrl()) || fs.existsSync(audioPath()));
const audioInfo = new Map(); // botId -> { id, duration, title, performer } (file_id juga per bot)
const getAudio = (ctx) => audioInfo.get(botKey(ctx)) || null;

/** Unduh audio dari URL sendiri (cadangan bila Telegram gagal mengambil URL-nya) */
async function downloadAudio(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_AUDIO_BYTES) throw new Error(`file audio lebih dari ${Math.round(MAX_AUDIO_BYTES / 1048576)} MB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) throw new Error(`file audio lebih dari ${Math.round(MAX_AUDIO_BYTES / 1048576)} MB`);
  return buf;
}
const urlFileName = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || "menu.mp3"; } catch { return "menu.mp3"; }
};

/** Upload/ambil audio sekali per bot untuk mendapat file_id (pesan audio langsung dihapus lagi) */
async function ensureAudio(ctx) {
  if (getAudio(ctx) || !hasAudio()) return getAudio(ctx);
  const cfg = audioCfg();
  const extra = { disable_notification: true, ...(cfg.title ? { title: cfg.title } : {}), ...(cfg.performer ? { performer: cfg.performer } : {}) };
  const url = audioUrl();
  let m = null;
  try {
    if (/^https?:\/\//i.test(url)) {
      try {
        m = await ctx.replyWithAudio(url, extra); // Telegram mengambil langsung dari URL
      } catch (err) {
        console.warn("[MENU] Telegram gagal ambil audio dari URL, coba unduh sendiri:", err?.message);
        m = await ctx.replyWithAudio({ source: await downloadAudio(url), filename: urlFileName(url) }, extra);
      }
    } else {
      m = await ctx.replyWithAudio({ source: fs.createReadStream(audioPath()), filename: path.basename(audioPath()) }, extra);
    }
    const a = m?.audio;
    if (a?.file_id) audioInfo.set(botKey(ctx), { id: a.file_id, duration: a.duration, title: cfg.title || undefined, performer: cfg.performer || undefined });
  } catch (err) {
    console.warn("[MENU] Ambil audio menu gagal, menu tanpa audio:", err?.message);
  }
  if (m?.message_id) await ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {});
  return getAudio(ctx);
}

// ===== Foto slider (geser kiri/kanan) di dalam Rich Message menu & /start =====
// Sumber gambar (urutan prioritas):
//   1) config.js -> menuSlides: ["https://.../a.jpg", "Assets/foto2.jpg", ...]   (URL https atau path file lokal, maks 10)
//   2) otomatis: semua file Assets/slide*.jpg|jpeg|png|webp (urut nama)  -> ganti/tambah file ini untuk mengubah slider
//   menuSlides: false  -> matikan slider
// File lokal diunggah sekali per bot (file_id berlaku per bot), pesan upload langsung dihapus lagi.
const MAX_SLIDES = 10;
const slideSources = () => {
  const c = config.menuSlides;
  if (c === false) return [];
  if (Array.isArray(c) && c.length) return c.map(String).slice(0, MAX_SLIDES);
  try {
    const dir = path.join(process.cwd(), "Assets");
    return fs.readdirSync(dir).filter((f) => /^slide.*\.(jpe?g|png|webp)$/i.test(f)).sort().slice(0, MAX_SLIDES).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
};
// Ukuran foto slider: file lokal diperkecil lewat config.menuSlideScale (default 0.85 = 85% dari ukuran asli;
// 1 / false = tanpa perubahan). Foto asli di Assets tidak diubah. Slider URL tidak diperkecil (Telegram yang mengunduhnya).
const slideScale = () => {
  const v = config.menuSlideScale;
  if (v === false || v === 1) return 1;
  const n = Number(v ?? 0.85);
  return n > 0.2 && n < 1 ? n : 1;
};
async function slideSource(file) {
  const scale = slideScale();
  if (scale === 1) return { source: fs.createReadStream(file) };
  try {
    const { width } = await sharp(file).metadata();
    if (!width) throw new Error("tanpa lebar");
    const source = await sharp(file).rotate().resize({ width: Math.max(160, Math.round(width * scale)) }).jpeg({ quality: 85 }).toBuffer();
    return { source, filename: path.basename(file).replace(/\.[^.]+$/, "") + ".jpg" };
  } catch (err) {
    console.warn("[MENU] Foto slider gagal diperkecil, pakai ukuran asli:", err?.message);
    return { source: fs.createReadStream(file) };
  }
}
const slideCache = new Map(); // botId -> [{ id: "s1", media: { type: "photo", media: file_id | url } }]
const getSlides = (ctx) => slideCache.get(botKey(ctx)) || [];

async function ensureSlides(ctx) {
  const key = botKey(ctx);
  if (slideCache.has(key)) return slideCache.get(key);
  const srcs = slideSources().map((x) => (/^https?:\/\//i.test(x) ? { url: x } : { file: path.resolve(process.cwd(), x) })).filter((x) => x.url || fs.existsSync(x.file));
  const out = srcs.map((x) => x.url || null);
  const local = srcs.map((x, i) => ({ i, file: x.file })).filter((x) => x.file);
  try {
    for (let k = 0; k < local.length; k += MAX_SLIDES) {
      const chunk = local.slice(k, k + MAX_SLIDES);
      let msgs;
      const files = await Promise.all(chunk.map((c) => slideSource(c.file)));
      if (chunk.length === 1) msgs = [await ctx.replyWithPhoto(files[0], { disable_notification: true })];
      else msgs = await ctx.replyWithMediaGroup(files.map((f) => ({ type: "photo", media: f })), { disable_notification: true });
      msgs.forEach((m, j) => { out[chunk[j].i] = m?.photo?.at(-1)?.file_id || null; });
      await Promise.all(msgs.map((m) => ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {})));
    }
  } catch (err) {
    console.warn("[MENU] Upload foto slider gagal, menu tanpa slider:", err?.message);
    return []; // tidak di-cache: dicoba lagi pada menu berikutnya
  }
  const list = out.filter(Boolean).map((m, i) => ({ id: `s${i + 1}`, media: { type: "photo", media: m } }));
  slideCache.set(key, list);
  return list;
}

/** Bentuk parameter rich_message; dengan banner dan/atau audio bila file_id tersedia */
function richPayload(ctx, view, { banner = true, audio = false, slides = false } = {}) {
  const bannerFileId = banner ? getBannerId(ctx) : null;
  const au = audio ? getAudio(ctx) : null;
  const sl = slides && view.slides ? getSlides(ctx) : [];
  let html = view.rich;
  const media = [];
  // Urutan tampilan: slider (atas) -> audio -> teks & tabel -> banner/thumb -> blockquote.
  // Penanda {{SLIDES}} = tempat slider, {{BANNER}} = tempat banner; tanpa media, penanda dibuang.
  const slideHtml = sl.length ? `<tg-slideshow>${sl.map((x) => `<img src="tg://photo?id=${x.id}"/>`).join("")}</tg-slideshow>` : "";
  const bannerHtml = bannerFileId ? `<img src="tg://photo?id=banner"/>` : "";
  // Halaman tanpa penanda {{BANNER}} (All Menu, AI Menu, kategori, Tq To, dll): thumb di paling atas
  const bannerAtTop = bannerHtml && !/\{\{BANNER\}\}/.test(html);
  html = html.replace(/\{\{SLIDES\}\}\n?/g, "").replace(/\{\{BANNER\}\}\n?/g, bannerHtml ? bannerHtml + "\n" : "");
  for (const x of sl) media.push(x);
  if (!bannerFileId && !au && !media.length) return { html };
  // Slider + audio di paling atas (slider dulu, lalu audio)
  let top = slideHtml;
  if (au) {
    top += `<audio src="tg://audio?id=menuaudio"/>`;
    media.push({ id: "menuaudio", media: { type: "audio", media: au.id, ...(au.duration ? { duration: au.duration } : {}), ...(au.title ? { title: au.title } : {}), ...(au.performer ? { performer: au.performer } : {}) } });
  }
  html = (bannerAtTop ? bannerHtml : "") + top + html;
  if (bannerFileId) media.unshift({ id: "banner", media: { type: "photo", media: bannerFileId } });
  return { html, media };
}
/** Urutan percobaan kirim/edit: (banner+audio) -> banner -> polos */
function richAttempts(ctx, view) {
  const list = [];
  if (view.audio && getAudio(ctx) && !audioEmbedBroken) list.push({ banner: Boolean(getBannerId(ctx)), audio: true });
  if (getBannerId(ctx)) list.push({ banner: true, audio: false });
  list.push({ banner: false, audio: false });
  // Dengan foto slider dulu; kalau Telegram menolak, ulangi tanpa slider
  if (view.slides && getSlides(ctx).length && !slidesBroken) return [...list.map((o) => ({ ...o, slides: true })), ...list];
  return list;
}
let slidesBroken = false; // jadi true bila server menolak slideshow di Rich Message
let audioEmbedBroken = false; // jadi true bila server menolak blok audio di Rich Message (pakai pesan audio biasa)
const PER_PAGE = 4; // maksimal 4 tombol kategori per halaman (grid 2x2)

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (s = "", n = 48) => { const a = Array.from(String(s)); return a.length > n ? a.slice(0, n - 1).join("").trimEnd() + "…" : a.join(""); };
// Ambil kalimat pertama saja (buang contoh pemakaian) supaya daftar ringkas
const firstLine = (s = "") => s.split("\n")[0].split(/\.\s|\s*Contoh:/)[0].replace(/\.$/, "");

/** Kategori yang boleh dilihat: owner disembunyikan dari non-owner.
 * add: addowner/addsender/listsender/delsender/prem/pt hanya untuk owner & partner,
 *      sedangkan command role (/addrole, /delrole, /listrole — ditandai roleCmd) untuk yang boleh memberi role CPanel
 *      (Owner, Developer/Root/Founder/Owner CPanel, TK, PT, Premium) dan tidak tersedia di bot clone. */
function visibleCategories(userId, ctx) {
  const grouped = getPluginsByCategory();
  const clone = isCloneCtx(ctx);
  const out = [];
  for (const [cat, plugins] of Object.entries(grouped)) {
    if (clone && CLONE_BLOCKED_CATEGORIES.has(cat)) continue; // bot clone: tanpa cpanel/cvps
    if (cat === "owner") { if (isOwner(userId)) out.push([cat, plugins]); continue; }
    if (cat === "add") {
      const base = isOwner(userId) || isPartner(userId);
      const SENDER_CMDS = new Set(["addsender", "listsender", "delsender", "pilihsender"]); // terbuka untuk semua user (sender milik masing-masing)
      const list = plugins.filter((p) => (p.roleCmd ? !clone && canGrant(userId, "mgr2") : base || [].concat(p.command).some((c) => SENDER_CMDS.has(c))));
      if (list.length) out.push([cat, list]);
      continue;
    }
    out.push([cat, plugins]);
  }
  return out;
}


/**
 * Template menu utama, format RICH MESSAGE Telegram (Bot API 10.1, sendRichMessage).
 * Tag yang bisa dipakai: <p> <br> <b> <i> <u> <s> <tg-spoiler> <code> <pre> <a href>
 *   <blockquote> <details><summary>..</summary>..</details> dan tabel asli:
 *   <table bordered striped><tr><th>..</th></tr><tr><td>..</td></tr></table>
 * Placeholder (otomatis diisi & di-escape): {name} {username} {namebot} {prefix}
 *   {runtime} {node} {features} {groups} {users} {points} {time} {page} {pages}
 * Mau ganti tampilan? Tambahkan `menuTemplate: "..."` di config.js, atau edit teks di bawah.
 */
const RICH_TEMPLATE = `{{SLIDES}}\n<p><tg-emoji emoji-id="6095851644468072524">👋</tg-emoji> Halo, <b>{name}</b> selamat menggunakan bot <b>{namebot}</b></p>\n<table bordered striped>\n<tr><th><tg-emoji emoji-id="5287684458881756303">🤖</tg-emoji> SYSTEM</th><th>STATUS</th></tr>\n<tr><td><tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> Runtime</td><td>{runtime}</td></tr>\n<tr><td><tg-emoji emoji-id="6120946172010959542">🟢</tg-emoji> Node</td><td>{node}</td></tr>\n<tr><td><tg-emoji emoji-id="6123129707614441341">✨</tg-emoji> Features</td><td>{features}</td></tr>\n<tr><td><tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Groups</td><td>{groups}</td></tr>\n<tr><td>🙋 Users</td><td>{users}</td></tr>\n</table>\n<table bordered striped>\n<tr><th><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> PROFILE</th><th>INFO</th></tr>\n<tr><td><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Username</td><td>{username}</td></tr>\n<tr><td><tg-emoji emoji-id="6089104607328342288">🪙</tg-emoji> Points</td><td>{points}</td></tr>\n<tr><td><tg-emoji emoji-id="5969545478155539601">🕒</tg-emoji> Time</td><td>{time}</td></tr>\n</table>\n{{BANNER}}\n<blockquote><tg-emoji emoji-id="5431721976769027887">⬇️</tg-emoji> <b>Select a menu below to start</b><br>Prefix: <code>{prefix}</code> • Halaman {page}/{pages}</blockquote>`;

// Cadangan bila Rich Message ditolak (bot API lama / server lokal): HTML biasa + <pre>
const LEGACY_TEMPLATE = `<tg-emoji emoji-id="6095851644468072524">👋</tg-emoji> Halo, <b>{name}</b> selamat menggunakan bot <b>{namebot}</b>

<blockquote><tg-emoji emoji-id="5287684458881756303">🤖</tg-emoji> SYSTEM
<tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> Runtime  : {runtime}
<tg-emoji emoji-id="6120946172010959542">🟢</tg-emoji> Node     : {node}
<tg-emoji emoji-id="6123129707614441341">✨</tg-emoji> Features : {features}
<tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Groups   : {groups}
🙋 Users    : {users}</blockquote>
<blockquote><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> PROFILE
<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Username : {username}
<tg-emoji emoji-id="6089104607328342288">🪙</tg-emoji> Points   : {points}
<tg-emoji emoji-id="5969545478155539601">🕒</tg-emoji> Time     : {time}</blockquote>
<blockquote><tg-emoji emoji-id="5431721976769027887">⬇️</tg-emoji> <b>Select a menu below to start</b>
Prefix: <code>{prefix}</code>  •  Halaman {page}/{pages}</blockquote>`;

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? h(vars[k]) : m));

function fmtRuntime(sec) {
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60), ss = Math.floor(sec % 60);
  return [d && `${d}h`, (d || hh) && `${hh}j`, `${m}m`, `${ss}d`].filter(Boolean).join(" ");
}

function fmtTime() {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: config.timezone || "Asia/Jakarta",
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

const countCmds = (plugins) => new Set(plugins.flatMap((p) => p.command)).size;

function homeView(ctx, uid, page = 0) {
  const cats = visibleCategories(uid, ctx);
  const total = cats.reduce((n, [, p]) => n + countCmds(p), 0);
  const pageCount = Math.max(Math.ceil(cats.length / PER_PAGE), 1);
  const pg = ((page % pageCount) + pageCount) % pageCount; // berputar: prev di hal 1 -> hal terakhir

  const from = ctx.from || {};
  const vars = {
    name: from.first_name || "Kak",
    username: from.username ? "@" + from.username : from.first_name || "-",
    namebot: config.botName,
    prefix: config.prefix,
    runtime: fmtRuntime(process.uptime()),
    node: process.version,
    features: total,
    groups: Object.keys(groupsDb.data.groups || {}).length,
    users: Object.keys(usersDb.data.users || {}).length,
    points: getUser(uid).koin ?? 0,
    time: fmtTime(),
    page: pg + 1,
    pages: pageCount,
  };
  // Nilai di-escape (aman dari HTML injection); template sendiri dianggap tepercaya
  const rich = fill(config.menuTemplate || RICH_TEMPLATE, vars);
  const text = fill(LEGACY_TEMPLATE, vars);

  // Cpanel Menu membuka hub tombol (Create Panel, dll); daftar perintah ada di tombol "Daftar Perintah"
  const buttons = cats.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE).map(([cat]) => catButton(cat, cat === "cpanel" ? `menu:cp:${uid}` : `menu:c:${cat}:0:${uid}`));
  // Susun 2 tombol per baris (grid 2x2)
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (pageCount > 1) {
    rows.push([
      prevBtn(`menu:h:${pg - 1}:${uid}`),
      { text: `${pg + 1} / ${pageCount}`, callback_data: `menu:n:${uid}` },
      nextBtn(`menu:h:${pg + 1}:${uid}`),
    ]);
  }
  rows.push([
    { text: "Utama", icon_custom_emoji_id: "6305157130357839863", emoji_fallback: "🏠", callback_data: `menu:s:${uid}` },
    { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` },
  ]);
  return { text, rich, slides: true, reply_markup: paint({ inline_keyboard: rows }, 0) };
}


// ===== Tampilan /start (rich + foto jpg + tombol All Menu & Tq To) =====
const START_RICH = `{{SLIDES}}\n<h2><tg-emoji emoji-id="6095851644468072524">👋</tg-emoji> Halo, {name}!</h2>\n<p>Selamat datang di <b>{namebot}</b> — bot Telegram serba bisa: download, AI, game, sticker, tools, dan banyak lagi.</p>\n<table bordered striped>\n<tr><th><tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> INFO BOT</th><th>STATUS</th></tr>\n<tr><td><tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> Runtime</td><td>{runtime}</td></tr>\n<tr><td><tg-emoji emoji-id="6123129707614441341">✨</tg-emoji> Fitur</td><td>{features} perintah</td></tr>\n<tr><td>🙋 Users</td><td>{users}</td></tr>\n<tr><td><tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Groups</td><td>{groups}</td></tr>\n</table>\n<table bordered striped>\n<tr><th><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> PROFIL KAMU</th><th>INFO</th></tr>\n<tr><td><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Username</td><td>{username}</td></tr>\n<tr><td><tg-emoji emoji-id="6089104607328342288">🪙</tg-emoji> Koin</td><td>{points}</td></tr>\n<tr><td><tg-emoji emoji-id="5413879192267805083">📅</tg-emoji> Tanggal</td><td>{time}</td></tr>\n</table>\n{{BANNER}}\n<blockquote><tg-emoji emoji-id="5431721976769027887">⬇️</tg-emoji> Tekan <b>All Menu</b> untuk melihat semua fitur, atau <b>Tq To</b> untuk daftar developer &amp; supporter.<br>Prefix: <code>{prefix}</code></blockquote>`;

const START_LEGACY = `<tg-emoji emoji-id="6095851644468072524">👋</tg-emoji> Halo, <b>{name}</b>!
Selamat datang di <b>{namebot}</b> — bot Telegram serba bisa: download, AI, game, sticker, tools, dan banyak lagi.

<blockquote><tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> INFO BOT
<tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> Runtime : {runtime}
<tg-emoji emoji-id="6123129707614441341">✨</tg-emoji> Fitur   : {features} perintah
🙋 Users   : {users}
<tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Groups  : {groups}</blockquote>
<blockquote><tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> PROFIL KAMU
<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> Username : {username}
<tg-emoji emoji-id="6089104607328342288">🪙</tg-emoji> Koin     : {points}
<tg-emoji emoji-id="5413879192267805083">📅</tg-emoji> Tanggal  : {time}</blockquote>
<blockquote><tg-emoji emoji-id="5431721976769027887">⬇️</tg-emoji> Tekan <b>All Menu</b> untuk semua fitur, atau <b>Tq To</b> untuk daftar developer &amp; supporter.
Prefix: <code>{prefix}</code></blockquote>`;

function baseVars(ctx, uid) {
  const total = visibleCategories(uid, ctx).reduce((n, [, p]) => n + countCmds(p), 0);
  const from = ctx.from || {};
  return {
    name: from.first_name || "Kak",
    username: from.username ? "@" + from.username : from.first_name || "-",
    namebot: config.botName,
    prefix: config.prefix,
    runtime: fmtRuntime(process.uptime()),
    features: total,
    groups: Object.keys(groupsDb.data.groups || {}).length,
    users: Object.keys(usersDb.data.users || {}).length,
    points: getUser(uid).koin ?? 0,
    time: fmtTime(),
  };
}

function startView(ctx, uid) {
  const vars = baseVars(ctx, uid);
  const rows = [
    [
      { text: "All Menu", icon_custom_emoji_id: "6307686831735444755", emoji_fallback: "📖", callback_data: `menu:h:0:${uid}` },
      { text: "Tq To", icon_custom_emoji_id: "6098162938168742004", emoji_fallback: "❤️", callback_data: `menu:t:${uid}` },
    ],
    [
      { text: "Install Panel", icon_custom_emoji_id: "5967347859354293440", emoji_fallback: "🚀", callback_data: `menu:i:${uid}` },
      { text: "Jadi Bot", icon_custom_emoji_id: "5287684458881756303", emoji_fallback: "🤖", callback_data: `menu:j:${uid}` },
    ],
    ...(isCloneCtx(ctx) ? [] : [[{ text: "Build", icon_custom_emoji_id: "5341715473882955310", emoji_fallback: "⚙️", callback_data: `menu:b:${uid}` }]]),
    [{ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` }],
  ];
  return {
    text: fill(START_LEGACY, vars),
    rich: fill(config.startTemplate || START_RICH, vars),
    photo: true,
    audio: true,
    slides: true,
    reply_markup: paint({ inline_keyboard: rows }, 0),
  };
}

// Daftar nama ada di file terpisah: credits.js
const creditLink = (x) => (x.username ? `https://t.me/${String(x.username).replace(/^@/, "")}` : x.url || "");
const creditName = (x) => {
  const l = creditLink(x);
  return l ? `<a href="${h(l)}">${h(x.name)}</a>` : h(x.name);
};

function tqtoView(uid) {
  const devs = credits.devs || [];
  const sups = credits.supporters || [];
  const note = credits.thanksNote || "Terima kasih untuk semua pengguna ❤️";

  // Seluruh teks Tq To memakai Rich Message
  const rich =
    `<h1><tg-emoji emoji-id="4956269706987177066">💝</tg-emoji> Tq To</h1>` +
    `<blockquote>Terima kasih kepada orang-orang hebat di balik <b>${h(config.botName)}</b></blockquote>` +
    `<h2><tg-emoji emoji-id="5967763324425736076">👨‍💻</tg-emoji> Developer</h2>` +
    (devs.length
      ? `<table bordered striped><tr><th><tg-emoji emoji-id="6202001327397020033">🏷️</tg-emoji> Nama</th><th><tg-emoji emoji-id="6156436440260549720">🎖️</tg-emoji> Peran</th></tr>` +
        devs.map((d) => `<tr><td><tg-emoji emoji-id="5967763324425736076">👨‍💻</tg-emoji> <b>${creditName(d)}</b></td><td>${h(d.role || "Developer")}</td></tr>`).join("") +
        `</table>`
      : `<p><i>Belum ada developer terdaftar.</i></p>`) +
    `<h2><tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> Supporter</h2>` +
    (sups.length
      ? `<table bordered striped><tr><th><tg-emoji emoji-id="6202001327397020033">🏷️</tg-emoji> Nama</th><th><tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> Keterangan</th></tr>` +
        sups.map((d) => `<tr><td><tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> <b>${creditName(d)}</b></td><td>${h(d.role || "Support")}</td></tr>`).join("") +
        `</table>`
      : `<p><i>Belum ada supporter terdaftar.</i></p>`) +
    `<details><summary><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Tentang bot</summary><p><b>${h(config.botName)}</b> — dibuat dengan semaximal mungkin untuk kalian semua.</p></details>` +
    `<blockquote>${h(note)}</blockquote>`;

  // Cadangan bila server menolak Rich Message
  const text =
    `<tg-emoji emoji-id="4956269706987177066">💝</tg-emoji> <b>Tq To</b>\n\n` +
    `<tg-emoji emoji-id="5967763324425736076">👨‍💻</tg-emoji> <b>Developer</b>\n` +
    (devs.length ? devs.map((d) => `<tg-emoji emoji-id="5967763324425736076">👨‍💻</tg-emoji> ${creditName(d)} — <i>${h(d.role || "Developer")}</i>`).join("\n") : "<i>Belum ada.</i>") +
    `\n\n<tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> <b>Supporter</b>\n` +
    (sups.length ? sups.map((d) => `<tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> ${creditName(d)} — <i>${h(d.role || "Support")}</i>`).join("\n") : "<i>Belum ada.</i>") +
    `\n\n<blockquote>${h(note)}</blockquote>`;

  const rows = [
    [
      { text: "All Menu", icon_custom_emoji_id: "6307686831735444755", emoji_fallback: "📖", callback_data: `menu:h:0:${uid}` },
      { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", callback_data: `menu:s:${uid}` },
    ],
    [{ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` }],
  ];
  return { text, rich, reply_markup: paint({ inline_keyboard: rows }, 0) };
}

const ROWS_PER_PAGE = 8; // baris (plugin) per halaman kategori
const CAT_DESC = {
  main: "Menu utama & info bot", owner: "Khusus owner bot",
  add: "Tambah owner, premium, partner, sender WhatsApp & role (/addrole, /delrole, /listrole)", group: "Moderasi & pengaturan grup",
  user: "Akun, profil & claim koin harian", cek: "Cek persen bertema seru",
  fun: "Hiburan & obrolan seru", game: "Game tebak-tebakan & adu skill", download: "Unduh video, musik & file (10 koin)",
  tools: "Alat bantu sehari-hari (10 koin)", utility: "Screenshot web, translate, short link & upload ke URL (10 koin)", canvas: "Buat gambar & kutipan", sticker: "Buat & ubah stiker",
  search: "Cari info & referensi", ai: "Asisten AI, gambar & ringkasan",
  bypass: "Bypass link shortener: SFL, Ouo.io, Safelinku, Subs4Unlock, Delta, Bicolink, Sub2Unlock & bypass umum",
  cpanel: "Panel Pterodactyl: buat panel & admin panel, kelola server, setting, limit",
  cvps: "Create VPS DigitalOcean: buat, list, hapus & rebuild VPS, status akun, atur API key (Reseller VPS)",
};
const cap = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

/** Pecah plugin jadi daftar command: 1 command = 1 baris (alias tidak digabung) */
const flattenCmds = (plugins) => plugins.flatMap((pl) => pl.command.map((c) => ({ cmd: c, pl })));

/** Bagi daftar command jadi halaman berisi maksimal ROWS_PER_PAGE baris; sisanya lewat tombol Hal */
function categoryPages(plugins) {
  const items = flattenCmds(plugins);
  const pages = [];
  for (let i = 0; i < items.length; i += ROWS_PER_PAGE) pages.push(items.slice(i, i + ROWS_PER_PAGE));
  return pages.length ? pages : [[]];
}

/** Versi HTML biasa (cadangan bila Rich Message tidak tersedia): 1 command = 1 baris */
function legacyBlock({ cmd, pl }) {
  return `• <code>${config.prefix}${h(cmd)}</code>\n   ${h(short(firstLine(pl.description || "-")))}`;
}
function legacyBody(items) {
  return items.map(legacyBlock).join("\n\n") || "(kosong)";
}

/** Emoji premium eksplisit: <tg-emoji emoji-id="ID">emoji</tg-emoji> (jadi emoji biasa bila pemilik bot tidak premium) */
const tge = (id, e) => `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;

/** Sel "Usage": deskripsi + contoh pemakaian + label akses, semua rich */
function usageCell(pl) {
  const desc = pl.description || "-";
  const ex = desc.match(/Contoh:\s*([^\n]+)/i);
  let html = h(short(firstLine(desc), 90));
  if (ex) html += `<br><code>${h(ex[1].trim())}</code>`;
  const tags = [
    pl.ownerOnly && `${tge("5217822164362739968", "👑")} Owner`,
    pl.adminOnly && `${tge("6204072077159309131", "🛡️")} Admin`,
    pl.groupOnly && `${tge("5373012449597335010", "👥")} Grup`,
    pl.privateOnly && `${tge("5443038326535759644", "💬")} Private`,
  ].filter(Boolean);
  if (tags.length) html += `<br><i>${tags.join(" · ")}</i>`;
  return html;
}

/** Halaman kategori versi Rich Message: judul, kutipan, tabel Info & tabel Command/Usage (1 command = 1 baris) */
function richCategory(cat, cats, idx, chunk, pg, pageCount) {
  const p = config.prefix;
  const plugins = cats[idx][1];

  const rows = chunk.map(({ cmd, pl }) =>
    `<tr><td>${h(p + cmd)}</td><td>${usageCell(pl)}</td></tr>` // teks biasa -> otomatis jadi link command
  ).join("");

  return (
    `<h1>${catIconHtml(cat)} ${h(catLabel(cat))} Menu</h1>` +
    `<blockquote>${h(CAT_DESC[cat] || "Kumpulan perintah")}</blockquote>` +
    `<table bordered><tr><th><tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Info</th><th>Status</th></tr>` +
    `<tr><td><tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> Module</td><td>${h(catLabel(cat))} Menu</td></tr>` +
    `<tr><td><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> Total Cmd</td><td>${flattenCmds(plugins).length}</td></tr>` +
    `<tr><td>${tge("5416041192905265756", "🧭")} Menu</td><td>${idx + 1}/${cats.length}</td></tr>` +
    (pageCount > 1 ? `<tr><td><tg-emoji emoji-id="5334882760735598374">📄</tg-emoji> Halaman</td><td>${pg + 1}/${pageCount}</td></tr>` : "") +
    `</table>` +
    `<table bordered><tr><th><tg-emoji emoji-id="5373330964372004748">⌨️</tg-emoji> Command</th><th><tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> Usage</th></tr>${rows}</table>`
  );
}

// ===== Force Subscribe: perintahnya dikelompokkan di tombol "Force Subscribe" pada Group Menu =====
const FSUB_CMDS = ["setfsub", "delfsub", "listfsub", "setmode", "settings", "fsub", "reload", "checkfsub"];
const FSUB_SET = new Set(FSUB_CMDS);
const isFsubPlugin = (pl) => FSUB_SET.has(pl.command[0]);

function fsubView(ctx, uid) {
  const all = (getPluginsByCategory().group || []).filter(isFsubPlugin);
  const items = FSUB_CMDS.map((c) => all.find((pl) => pl.command[0] === c)).filter(Boolean).map((pl) => ({ cmd: pl.command[0], pl }));
  const p = config.prefix;
  const rows = items.map(({ cmd, pl }) => `<tr><td>${h(p + cmd)}</td><td>${usageCell(pl)}</td></tr>`).join("");
  const rich =
    `<h1>🔒 Force Subscribe</h1>` +
    `<blockquote>Wajib join channel sebelum chat di grup. Perintah di bawah khusus untuk admin grup.</blockquote>` +
    `<table bordered><tr><th><tg-emoji emoji-id="5373330964372004748">⌨️</tg-emoji> Command</th><th><tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> Usage</th></tr>${rows}</table>`;
  const text = `🔒 <b>FORCE SUBSCRIBE</b> — ${items.length} perintah\n\n` + legacyBody(items);
  const kb = [[
    { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", callback_data: `menu:c:group:0:${uid}` },
    { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` },
  ]];
  return { text, rich, reply_markup: paint({ inline_keyboard: kb }, 0) };
}

function categoryView(ctx, cat, page, uid) {
  // Perintah Force Subscribe tidak ditampilkan di daftar Group Menu, tapi lewat tombol "Force Subscribe"
  const cats = visibleCategories(uid, ctx).map(([c, pls]) => (c === "group" ? [c, pls.filter((pl) => !isFsubPlugin(pl))] : [c, pls]));
  const idx = cats.findIndex(([c]) => c === cat);
  if (idx === -1) return null;
  const pages = categoryPages(cats[idx][1]);
  const pg = Math.min(Math.max(page, 0), pages.length - 1);
  const legacyText =
    `${catIconHtml(cat)} <b>${h(catLabel(cat).toUpperCase())}</b> — ${flattenCmds(cats[idx][1]).length} perintah  •  menu ${idx + 1}/${cats.length}${pages.length > 1 ? `  (hal ${pg + 1}/${pages.length})` : ""}\n\n` +
    legacyBody(pages[pg]);


  // Prev/Next = pindah ke kategori (menu) sebelumnya / selanjutnya, berputar
  const prevCat = cats[(idx - 1 + cats.length) % cats.length][0];
  const nextCat = cats[(idx + 1) % cats.length][0];
  const homePage = Math.floor(idx / PER_PAGE);

  // Cpanel selalu dibuka lewat hub tombol (Create Panel, dll), sama seperti tombol "Cpanel Menu" di menu utama
  const goCat = (c) => (c === "cpanel" ? `menu:cp:${uid}` : `menu:c:${c}:0:${uid}`);
  // Teks tombol = nama menu saja; panah berasal dari ikon premium (tidak dobel dengan "◀" / "▶" di teks)
  const rows = [[
    prevBtn(goCat(prevCat), catLabel(prevCat)),
    nextBtn(goCat(nextCat), catLabel(nextCat)),
  ]];
  if (pages.length > 1) {
    // Command lebih banyak dari satu halaman -> pindah lewat tombol Hal (tidak ditaruh di bawah)
    const nav = [];
    if (pg > 0) nav.push(prevBtn(`menu:c:${cat}:${pg - 1}:${uid}`));
    nav.push({ text: `${pg + 1}/${pages.length}`, callback_data: `menu:n:${uid}` });
    if (pg < pages.length - 1) nav.push(nextBtn(`menu:c:${cat}:${pg + 1}:${uid}`));
    rows.push(nav);
  }
  // Daftar perintah Cpanel (dari tombol di hub) kembali ke hub Cpanel, kategori lain kembali ke menu utama
  const last = [{ text: "Kembali", icon_custom_emoji_id: ICON_ID.main, emoji_fallback: "🏠", callback_data: cat === "cpanel" ? `menu:cp:${uid}` : `menu:h:${homePage}:${uid}` }];
  if (pages.length === 1) last.push({ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` });
  if (cat === "group") rows.unshift([{ text: "Force Subscribe", callback_data: `menu:fs:${uid}` }]);
  rows.push(last);
  return { text: legacyText, rich: richCategory(cat, cats, idx, pages[pg], pg, pages.length), reply_markup: paint({ inline_keyboard: rows }, 0) };
}

let richDisabled = config.richMessages === false; // set true sendiri bila server menolak method rich
const notModified = (e) => /message is not modified/i.test(e?.message || "");

async function sendView(ctx, view) {
  let sent;
  if (!richDisabled) {
    await ensureBannerId(ctx);
    if (view.audio) await ensureAudio(ctx);
    if (view.slides) await ensureSlides(ctx);
    const extra = ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    for (const opt of richAttempts(ctx, view)) {
      try {
        sent = await ctx.telegram.callApi("sendRichMessage", {
          chat_id: ctx.chat.id,
          rich_message: richPayload(ctx, view, opt),
          reply_markup: view.reply_markup,
          ...extra,
        });
        break;
      } catch (err) {
        if (/not found|unknown method/i.test(err?.message || "")) { richDisabled = true; break; }
        console.warn(`[MENU] Rich Message gagal${opt.slides ? " (dengan slider)" : opt.audio ? " (dengan audio)" : opt.banner ? " (dengan banner)" : ""}:`, err?.message);
        if (opt.slides && /slideshow|tg-slideshow|unsupported tag|can't parse/i.test(err?.message || "")) slidesBroken = true;
        if (opt.audio) {
          // Blok audio ditolak server: kirim lagunya sebagai pesan audio biasa, lalu lanjut kirim menu tanpa audio
          audioEmbedBroken = true;
          const au = getAudio(ctx);
          if (au) await ctx.telegram.sendAudio(ctx.chat.id, au.id, { disable_notification: true, ...extra }).catch(() => {});
        }
      }
    }
  }
  if (!sent && view.photo && hasBanner() && view.text.length <= 1024) {
    try {
      sent = await ctx.replyWithPhoto(getBannerId(ctx) || { source: fs.createReadStream(BANNER_PATH) }, {
        caption: view.text, parse_mode: "HTML", reply_markup: view.reply_markup,
      });
    } catch (err) {
      console.warn("[MENU] Kirim foto start gagal:", err?.message);
    }
  }
  sent ||= await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup, disable_web_page_preview: true });
  startAnim(ctx.telegram, sent?.chat?.id ?? ctx.chat.id, sent?.message_id, view.reply_markup);
  return sent;
}

async function safeEdit(ctx, view) {
  const msg = ctx.callbackQuery?.message;
  let done = false;
  if (msg?.photo && !msg.rich_message) {
    // Pesan fallback berupa foto+caption: tidak bisa diedit jadi teks panjang -> kirim ulang
    stopAnim(`${msg.chat.id}:${msg.message_id}`);
    await ctx.deleteMessage().catch(() => {});
    return sendView(ctx, view);
  }
  if (!richDisabled && msg) {
    await ensureBannerId(ctx);
    if (view.audio) await ensureAudio(ctx);
    if (view.slides) await ensureSlides(ctx);
    for (const opt of richAttempts(ctx, view)) {
      try {
        await ctx.telegram.callApi("editMessageText", {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          rich_message: richPayload(ctx, view, opt),
          reply_markup: view.reply_markup,
        });
        done = true;
        break;
      } catch (err) {
        if (notModified(err)) { done = true; break; }
        if (/not found|unknown method/i.test(err?.message || "")) { richDisabled = true; break; }
        console.warn(`[MENU] Edit rich gagal${opt.slides ? " (dengan slider)" : opt.audio ? " (dengan audio)" : opt.banner ? " (dengan banner)" : ""}:`, err?.message);
        if (opt.slides && /slideshow|tg-slideshow|unsupported tag|can't parse/i.test(err?.message || "")) slidesBroken = true;
        if (opt.audio) audioEmbedBroken = true;
      }
    }
  }
  if (!done) {
    try {
      await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup, disable_web_page_preview: true });
    } catch (err) {
      if (!notModified(err)) throw err;
    }
  }
  if (msg) startAnim(ctx.telegram, msg.chat.id, msg.message_id, view.reply_markup);
}

registerCallback("menu", async (ctx, args) => {
  const action = args[0];
  const uid = args[args.length - 1];

  // Catatan: tombol menu ini sengaja bisa dipakai oleh siapa saja (tidak hanya pemanggil /start),
  // jadi tidak ada lagi pengecekan ctx.from.id === uid di sini.

  if (action === "x") {
    const m = ctx.callbackQuery?.message;
    if (m) stopAnim(`${m.chat.id}:${m.message_id}`);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery();
  }
  if (action === "i") {
    // Hentikan animasi warna tombol dulu supaya tidak menimpa tombol Install Panel
    const m = ctx.callbackQuery?.message;
    if (m) stopAnim(`${m.chat.id}:${m.message_id}`);
    return showInstallMenu(ctx);
  }
  if (action === "b") {
    const m = ctx.callbackQuery?.message;
    if (m) stopAnim(`${m.chat.id}:${m.message_id}`);
    return showBuildMenu(ctx);
  }
  if (action === "cp") {
    const m = ctx.callbackQuery?.message;
    if (m) stopAnim(`${m.chat.id}:${m.message_id}`);
    return showCpanelHub(ctx);
  }
  if (action === "j") {
    const m = ctx.callbackQuery?.message;
    if (m) stopAnim(`${m.chat.id}:${m.message_id}`);
    return showJadibotMenu(ctx);
  }
  if (action === "n") return ctx.answerCbQuery(); // tombol penunjuk halaman, tidak melakukan apa-apa
  if (action === "h") {
    await safeEdit(ctx, homeView(ctx, uid, parseInt(args[1]) || 0));
    return ctx.answerCbQuery();
  }
  if (action === "s") {
    await safeEdit(ctx, startView(ctx, uid));
    return ctx.answerCbQuery();
  }
  if (action === "t") {
    await safeEdit(ctx, tqtoView(uid));
    return ctx.answerCbQuery();
  }
  if (action === "fs") {
    await safeEdit(ctx, fsubView(ctx, uid));
    return ctx.answerCbQuery();
  }
  if (action === "c") {
    const view = categoryView(ctx, args[1], parseInt(args[2]) || 0, uid);
    if (!view) return ctx.answerCbQuery("Kategori tidak ditemukan.");
    await safeEdit(ctx, view);
    return ctx.answerCbQuery();
  }
  return ctx.answerCbQuery();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START_FRAMES = ["▱▱▱▱▱  0%", "▰▰▱▱▱  40%", "▰▰▰▰▱  80%", "▰▰▰▰▰  100%"];

/** Animasi loading singkat khusus /start: satu pesan diedit beberapa kali lalu dihapus */
let draftDisabled = false; // jadi true bila server Bot API menolak sendRichMessageDraft

async function startLoading(ctx) {
  if (config.loading?.start === false) return;

  // Utama: placeholder "draft" Rich Message (Bot API 10.1+). Muncul instan dan OTOMATIS tergantikan
  // begitu menu /start terkirim, tanpa edit / hapus pesan. Bila gagal, jatuh ke animasi progress lama di bawah.
  if (!draftDisabled) {
    try {
      const draftId = Date.now() % 2147483647 || 1;
      await ctx.telegram.callApi("sendRichMessageDraft", {
        chat_id: ctx.chat.id,
        draft_id: draftId,
        rich_message: { html: "<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> <i>Lagi nyiapin menu...</i>" },
      });
      return;
    } catch (err) {
      if (/not found|unknown method/i.test(err?.message || "")) draftDisabled = true;
      console.warn("[MENU] Draft loading /start gagal, pakai animasi biasa:", err?.message);
    }
  }

  const text = (i) => `⏳ Memuat ${config.botName}...\n${START_FRAMES[i]}`;
  let m;
  try {
    m = await ctx.reply(text(0));
    for (let i = 1; i < START_FRAMES.length; i++) {
      await sleep(450);
      await ctx.telegram.editMessageText(m.chat.id, m.message_id, undefined, text(i));
    }
    await sleep(350);
  } catch {
    /* loading hanya hiasan, abaikan error */
  } finally {
    if (m) await ctx.telegram.deleteMessage(m.chat.id, m.message_id).catch(() => {});
  }
}

export default {
  command: ["menu", "help", "cmd", "start"],
  category: "main",
  loading: false, // /start punya animasi loading sendiri
  description: "Buka menu perintah dengan tombol (/menu atau /menu <kategori>)",
  run: async (ctx, { args }) => {
    const uid = ctx.from.id;
    const cmd = (ctx.message?.text || "").trim().replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    if (cmd === "start") await startLoading(ctx);
    if (cmd === "start") return sendView(ctx, startView(ctx, uid));
    const wanted = args[0]?.toLowerCase();
    if (wanted === "cpanel" && visibleCategories(uid, ctx).some(([c]) => c === "cpanel")) return replyCpanelHub(ctx);
    if (wanted) {
      const view = categoryView(ctx, wanted, 0, uid);
      if (view) return sendView(ctx, view);
    }
    const view = homeView(ctx, uid);
    await sendView(ctx, view);
  },
};

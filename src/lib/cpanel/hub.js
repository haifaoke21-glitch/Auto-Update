// Hub CPanel interaktif: menu tombol -> Create Panel (pilih versi V1–V20 & ukuran 1–10GB / Unli) -> kirim nama.
// Dibuka lewat /cpanel atau tombol "Cpanel Menu" di /menu. Alur pembuatan panel tetap memakai createPanelFlow
// (wizard pilih runtime & egg), jadi hasil akhirnya sama dengan perintah /2gb nama.
import config from "../../../config.js";
import { h, cfg, inGroup } from "./util.js";
import { title, sub, quote, table, note, replyView, sendView, editCbView, dropAnim } from "../richUi.js";
import { registerCallback } from "../callbacks.js";
import { E, emo } from "../emo.js";
import { isCloneCtx } from "../cloneGuard.js";
import { highestRole, currentRoleInfo, isStaff, premSlots, resSlots, slotLabel, canUseVps, canCreatePanel, canCreateAdmin, SLOTS } from "./roles.js";
import { getPanel, getSetting, slotName } from "./ptero.js";
import { checkLimit, fmtLimit } from "./limit.js";
import { specFor, createPanelFlow, createAdminFlow } from "./create.js";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;
const SIZES = Array.from({ length: 10 }, (_, i) => String(i + 1));
const PENDING_TTL = 3 * 60 * 1000;
const pending = new Map(); // uid -> { kind, slot, size, chatId, msgId, exp }

const onOff = (v) => (v ? `${E.on} ON` : `${E.off} OFF`);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const nav = (uid, back) => [
  ...(back ? [{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "5352759161945867747", emoji_fallback: "🔙", callback_data: back }] : []),
  { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `cph:x:${uid}` },
];

/** Slot panel yang boleh dipakai user untuk membuat panel / admin panel (dan sudah dikonfigurasi owner) */
const panelSlots = (uid) => SLOTS.filter((s) => canCreatePanel(uid, s) && getPanel(s));
const adminUseSlot = (slot) => (slot === "1" && getSetting("adp") && getPanel("adp") ? "adp" : slot);
const adminSlots = (uid) => SLOTS.filter((s) => canCreateAdmin(uid, s) && getPanel(adminUseSlot(s)));

/** Alasan user belum bisa membuat (null = boleh) */
function denyReason(uid, kind) {
  if (kind === "panel" ? !getSetting("panelres") && !isStaff(uid) : !getSetting("paneladp") && !isStaff(uid)) {
    return "Fitur ini sedang dimatikan oleh owner.";
  }
  const slots = kind === "panel" ? panelSlots(uid) : adminSlots(uid);
  if (!slots.length) {
    const hasRole = kind === "panel" ? resSlots(uid).length || isStaff(uid) : premSlots(uid).length || isStaff(uid);
    return hasRole ? "Panel untuk role kamu belum dikonfigurasi owner." : kind === "panel" ? "Kamu butuh role Reseller untuk membuat panel." : "Kamu butuh role Premium untuk membuat admin panel.";
  }
  if (cfg().groupOnly && !isStaff(uid)) return "GROUP";
  return null;
}

// ---------- tampilan ----------
function hubRich(uid) {
  const top = highestRole(uid);
  const info = currentRoleInfo(uid); // 1 role: yang terakhir di-add + servernya
  const lim = checkLimit(uid);
  const configured = SLOTS.filter((s) => getPanel(s));
  return (
    title(E.pc, "CPanel — Pterodactyl Manager") +
    table(["Profil", "Info"], [
      [`${emo(top.icon)} Rank`, `<b>${h(top.label)}</b>`],
      [`${E.receipt} Role`, info ? `${emo(info.icon)} ${h(info.label)}` : "-"],
      [`${E.pc} Server`, info ? h(info.server) : "-"],
      [`${E.chart} Limit`, `${lim.limit === null ? "∞ Unlimited" : `${lim.used}/${fmtLimit(lim.limit)}`} (${h(lim.role.toUpperCase())})`],
      [`${E.puzzle} Panel aktif`, configured.length ? configured.map((s) => h(slotName(s))).join(", ") : "belum ada"],
      [`${E.gear} Create Panel`, onOff(getSetting("panelres"))],
      [`${E.shield} Admin Panel`, onOff(getSetting("paneladp"))],
    ]) +
    quote("Tekan <b>Create Panel</b> lalu pilih ukuran server (1GB–10GB atau Unlimited).")
  );
}

const hubRows = (uid) => [
  [
    { text: "Create Panel", icon_custom_emoji_id: "6123129707614441341", emoji_fallback: "🆕", callback_data: `cph:cp:${uid}` },
    { text: "Create Admin Panel", icon_custom_emoji_id: "6204072077159309131", emoji_fallback: "🛡️", callback_data: `cph:ad:${uid}` },
  ],
  [
    { text: "Panduan", icon_custom_emoji_id: "6307686831735444755", emoji_fallback: "📖", callback_data: `cph:gd:${uid}` },
    { text: "Daftar Perintah", icon_custom_emoji_id: "6307686831735444755", emoji_fallback: "📋", callback_data: `menu:c:cpanel:0:${uid}` },
  ],
  [
    { text: "Menu", icon_custom_emoji_id: "5352759161945867747", emoji_fallback: "🔙", callback_data: `menu:h:0:${uid}` },
    { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `cph:x:${uid}` },
  ],
];

function versionView(uid, kind, slots) {
  const cb = (s) => `cph:${kind === "panel" ? "vp" : "va"}:${s}:${uid}`;
  const rows = chunk(slots.map((s) => ({ text: slotLabel(s), callback_data: cb(s) })), 5);
  rows.push(nav(uid, `cph:h:${uid}`));
  return {
    rich:
      title(kind === "panel" ? E.fresh : E.shield, kind === "panel" ? "Create Panel" : "Create Admin Panel") +
      quote("Pilih <b>versi panel</b> yang ingin dipakai:") +
      table(["Versi", "Server"], slots.map((s) => [slotLabel(s), h(slotName(kind === "panel" ? s : adminUseSlot(s)))])),
    rows,
  };
}

function sizeView(uid, slot, canBack) {
  const rows = chunk(SIZES.map((n) => ({ text: `${n}GB`, callback_data: `cph:sz:${slot}:${n}:${uid}` })), 5);
  rows.push([{ text: "Unlimited", icon_custom_emoji_id: "6123129707614441341", emoji_fallback: "♾️", callback_data: `cph:sz:${slot}:unli:${uid}` }]);
  rows.push(nav(uid, canBack ? `cph:cp:${uid}:all` : `cph:h:${uid}`));
  const specRows = [...SIZES, "unli"].map((n) => {
    const s = specFor(n);
    return [`<b>${s.label}</b>`, n === "unli" ? "∞" : `${s.memory} MB`, n === "unli" ? "∞" : `${s.disk} MB`, n === "unli" ? "∞" : `${s.cpu}%`];
  });
  return {
    rich:
      title("🆕", `Create Panel ${h(slotLabel(slot))}`) +
      table(["Ukuran", "RAM", "Disk", "CPU"], specRows) +
      quote(`Server: <b>${h(slotName(slot))}</b>`, "Pilih ukuran server:"),
    rows,
  };
}

function guideRich(uid) {
  const p = config.prefix;
  const res = resSlots(uid);
  const prem = premSlots(uid);
  const staff = isStaff(uid);
  const access = table(["Akses kamu", "Status"], [
    ...(staff ? [["Panel & manajemen server", `${E.ok} Semua fitur`]] : []),
    ["Buat panel", res.length || staff ? `${E.ok} ${staff ? "semua versi" : res.map(slotLabel).join(", ")}` : `${E.no} butuh Reseller`],
    ["Buat admin panel", prem.length || staff ? `${E.ok} ${staff ? "semua versi" : prem.map(slotLabel).join(", ")}` : `${E.no} butuh Premium`],
    ["Create VPS (CVPS)", canUseVps(uid) ? `${E.ok} Bisa` : `${E.no} butuh Reseller VPS`],
  ]);
  const guide = table(["Command", "Fungsi"], [
    [`<code>${p}1gb nama</code> … <code>${p}10gb nama</code><br><code>${p}unli nama</code>`, "Buat panel"],
    [`<code>${p}2gbv2 nama</code><br><code>${p}unliv3 nama</code>`, "Versi panel lain (V2–V20)"],
    [`<code>${p}cadp nama</code>`, "Buat admin panel (Premium)"],
    [`<code>${p}cvps</code> • <code>${p}listvps</code><br><code>${p}delvps id</code> • <code>${p}rebuild id</code><br><code>${p}statusdo</code>`, "Kelola VPS DigitalOcean (Reseller VPS)"],
  ]);
  return (
    title(E.book, "Panduan CPanel") + access + sub(E.keyboard, "Lewat perintah") + guide +
    quote("Balas pesan user saat membuat panel agar data login dikirim ke dia.", "Lewat tombol, data login dikirim ke DM kamu.")
  );
}

// ---------- kirim / edit ----------
/** Edit pesan callback; pesan foto+caption (fallback menu) dihapus lalu dikirim ulang */
async function show(ctx, rich, rows) {
  const msg = ctx.callbackQuery?.message;
  if (msg && !(msg.photo && !msg.rich_message)) return editCbView(ctx, rich, rows);
  if (msg) { dropAnim(ctx); await ctx.deleteMessage().catch(() => {}); }
  return sendView(ctx.telegram, ctx.chat.id, rich, rows);
}

/** Buka hub dari tombol menu */
export async function showCpanelHub(ctx) {
  const uid = ctx.from.id;
  if (isCloneCtx(ctx)) return ctx.answerCbQuery("Tidak tersedia di bot clone.", { show_alert: true });
  await show(ctx, hubRich(uid), hubRows(uid));
  return ctx.answerCbQuery().catch(() => {});
}

/** Buka hub dari perintah /cpanel */
export const replyCpanelHub = (ctx) => replyView(ctx, hubRich(ctx.from.id), hubRows(ctx.from.id));

async function askName(ctx, uid, kind, slot, size) {
  const m = ctx.callbackQuery.message;
  pending.set(String(uid), { kind, slot, size, chatId: m.chat.id, msgId: m.message_id, exp: Date.now() + PENDING_TTL });
  await ctx.answerCbQuery().catch(() => {});
  const what = kind === "panel" ? `Panel ${size === "unli" ? "Unlimited" : size + "GB"} ${slotLabel(slot)}` : `Admin Panel ${slotLabel(slot)}`;
  return show(
    ctx,
    title(kind === "panel" ? E.fresh : E.shield, `Create ${h(what)}`) +
      quote(
        `${E.pencil} <b>Balas pesan ini</b> dengan nama yang diinginkan.`,
        "Huruf kecil, angka, titik, strip atau underscore (3–20 karakter).",
        ...(kind === "admin" ? ["Tambah <code>,idtelegram</code> untuk mengirim data ke akun lain."] : []),
        "<i>Berlaku 3 menit.</i>"
      ),
    [[{ text: "Batalkan", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: `cph:cx:${uid}` }]]
  );
}

// ---------- tombol ----------
registerCallback("cph", async (ctx, args) => {
  const uid = String(ctx.from.id);
  if (isCloneCtx(ctx)) return ctx.answerCbQuery("Tidak tersedia di bot clone.", { show_alert: true });
  if (args[args.length - 1] !== uid && args[args.length - 2] !== uid) {
    return ctx.answerCbQuery("Ini bukan menu kamu. Ketik /cpanel untuk membuka menu sendiri.", { show_alert: true });
  }
  const act = args[0];
  const alert = (t) => ctx.answerCbQuery(t, { show_alert: true }).catch(() => {});

  if (act === "x") {
    pending.delete(uid);
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery().catch(() => {});
  }
  if (act === "cx") pending.delete(uid);
  if (act === "h" || act === "cx") {
    await show(ctx, hubRich(ctx.from.id), hubRows(uid));
    return ctx.answerCbQuery().catch(() => {});
  }
  if (act === "gd") {
    await show(ctx, guideRich(ctx.from.id), [nav(uid, `cph:h:${uid}`)]);
    return ctx.answerCbQuery().catch(() => {});
  }

  if (act === "cp" || act === "ad") {
    const kind = act === "cp" ? "panel" : "admin";
    const why = denyReason(ctx.from.id, kind);
    if (why === "GROUP") {
      if (!inGroup(ctx)) return alert("Create panel hanya bisa dipakai di dalam grup. Data login dikirim lewat DM.");
    } else if (why) return alert(why);
    const slots = kind === "panel" ? panelSlots(ctx.from.id) : adminSlots(ctx.from.id);
    if (!slots.length) return alert(kind === "panel" ? "Belum ada panel yang bisa kamu pakai." : "Belum ada admin panel yang bisa kamu pakai.");
    if (slots.length === 1) {
      if (kind === "admin") return askName(ctx, uid, "admin", slots[0]);
      const v = sizeView(uid, slots[0], false);
      await show(ctx, v.rich, v.rows);
      return ctx.answerCbQuery().catch(() => {});
    }
    const v = versionView(uid, kind, slots);
    await show(ctx, v.rich, v.rows);
    return ctx.answerCbQuery().catch(() => {});
  }

  if (act === "vp") {
    const slot = args[1];
    if (!SLOTS.includes(slot) || !canCreatePanel(ctx.from.id, slot) || !getPanel(slot)) return alert("Versi panel tidak tersedia untuk kamu.");
    const v = sizeView(uid, slot, true);
    await show(ctx, v.rich, v.rows);
    return ctx.answerCbQuery().catch(() => {});
  }
  if (act === "va") {
    const slot = args[1];
    if (!SLOTS.includes(slot) || !canCreateAdmin(ctx.from.id, slot) || !getPanel(adminUseSlot(slot))) return alert("Versi admin panel tidak tersedia untuk kamu.");
    return askName(ctx, uid, "admin", slot);
  }
  if (act === "sz") {
    const [, slot, size] = args;
    if (!SLOTS.includes(slot) || !(SIZES.includes(size) || size === "unli")) return alert("Pilihan tidak valid.");
    if (!canCreatePanel(ctx.from.id, slot) || !getPanel(slot)) return alert("Versi panel tidak tersedia untuk kamu.");
    return askName(ctx, uid, "panel", slot, size);
  }
  return ctx.answerCbQuery().catch(() => {});
});

// ---------- penangkap nama (setelah user memilih ukuran) ----------
/** Middleware teks: terima nama panel setelah tombol ukuran ditekan. Perintah biasa tetap diteruskan. */
export async function cpanelHubTextHandler(ctx, next) {
  if (isCloneCtx(ctx) || !ctx.from) return next();
  const key = String(ctx.from.id);
  const p = pending.get(key);
  if (!p) return next();
  if (p.exp < Date.now()) { pending.delete(key); return next(); }
  if (p.chatId !== ctx.chat.id) return next();
  const text = String(ctx.message?.text || "").trim();
  if (!text || text.startsWith("/") || (config.prefix && text.startsWith(config.prefix))) return next();

  if (p.kind === "panel" && !NAME_RE.test(text.toLowerCase())) {
    return replyView(ctx, note("✕", "Nama tidak valid", "Hanya huruf kecil, angka, titik, strip atau underscore (3–20 karakter, tanpa spasi).<br>Balas lagi dengan nama lain, atau tekan Batalkan."));
  }
  pending.delete(key);
  ctx.telegram.deleteMessage(p.chatId, p.msgId).catch(() => {}); // rapikan pesan permintaan nama
  if (p.kind === "panel") return createPanelFlow(ctx, { slot: p.slot, size: p.size, args: [text.toLowerCase()] });
  return createAdminFlow(ctx, { slot: p.slot, args: [text] });
}

import config from "../../config.js";
import { reply, h, resolveTarget } from "../../src/lib/cpanel/util.js";
import { canGrant, applyRole, FLAT, MAX_SLOT, SLOTS, slotLabel, GRANT_TEXT, rolesOf } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { usersDb } from "../../src/database.js";

// ============================================================
//  /addrole  — satu command untuk MEMBERI semua role CPanel & CVPS
//  Alur: /addrole <id | @username | balas pesan>  ->  muncul tombol role.
//  Tombol HANYA bisa diklik oleh user yang mengetik command-nya, dan hanya
//  untuk role yang memang boleh dia beri (dicek ulang saat tombol ditekan).
//
//  callback_data: arole:<aksi>:<uidPemanggil>:<idTarget>[:<nilai>]
//    m menu utama | f <role> role datar | sp / sr pilih versi Premium / Reseller
//    p <slot> Premium Vn | r <slot> Reseller Vn
//    A semua akses | P Premium semua versi | R Reseller semua versi | x tutup
// ============================================================

const FLAT_GRANT = { developer: "super", root: "super", founder: "super", owner: "super", ceo: "staff", tk: "staff", pt: "staff", resvps: "staff" };
const FLAT_ORDER = ["developer", "root", "founder", "owner", "ceo", "tk", "pt", "resvps"];

const targetName = (id) => {
  const u = usersDb.data.users?.[id];
  return u?.username ? `@${u.username}` : u?.name || id;
};
const who = (id) => `<a href="tg://user?id=${h(id)}">${h(targetName(id))}</a> (<code>${h(id)}</code>)`;

const chunk = (arr, n) => {
  const rows = [];
  for (let i = 0; i < arr.length; i += n) rows.push(arr.slice(i, i + n));
  return rows;
};
const cb = (action, uid, tid, val) => `arole:${action}:${uid}:${tid}${val !== undefined ? ":" + val : ""}`;

/** Keyboard menu utama: hanya role yang boleh diberi pemanggil */
function mainKeyboard(uid, tid) {
  const btn = [];
  for (const r of FLAT_ORDER) {
    if (canGrant(uid, FLAT_GRANT[r])) btn.push({ text: `${FLAT[r].icon} ${FLAT[r].label}`, callback_data: cb("f", uid, tid, r) });
  }
  if (canGrant(uid, "mgr")) btn.push({ text: "Premium", icon_custom_emoji_id: "6206220960966646470", emoji_fallback: "💎", callback_data: cb("sp", uid, tid) });
  if (canGrant(uid, "mgr2")) btn.push({ text: "Reseller", icon_custom_emoji_id: "5859297284029681680", emoji_fallback: "🛒", callback_data: cb("sr", uid, tid) });
  const rows = chunk(btn, 2);
  if (canGrant(uid, "staff")) {
    rows.push([{ text: "Semua Akses", icon_custom_emoji_id: "6203761490894264678", emoji_fallback: "🌟", callback_data: cb("A", uid, tid) }]);
    rows.push([
      { text: "Premium Semua", icon_custom_emoji_id: "6206220960966646470", emoji_fallback: "💎", callback_data: cb("P", uid, tid) },
      { text: "Reseller Semua", icon_custom_emoji_id: "5859297284029681680", emoji_fallback: "🛒", callback_data: cb("R", uid, tid) },
    ]);
  }
  rows.push([{ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: cb("x", uid, tid) }]);
  return rows;
}

/** Keyboard pilih versi V1..V20 untuk Premium (p) / Reseller (r) */
function slotKeyboard(uid, tid, kind) {
  const rows = chunk(SLOTS.map((s) => ({ text: slotLabel(s), callback_data: cb(kind, uid, tid, s) })), 5);
  rows.push([
    { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", callback_data: cb("m", uid, tid) },
    { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: cb("x", uid, tid) },
  ]);
  return rows;
}

const currentRoles = (tid) => {
  const r = rolesOf(tid);
  return r.length ? r.map((x) => h(x.label)).join(" • ") : "<i>belum ada</i>";
};

function mainText(tid, note = "") {
  return (
    `<b><tg-emoji emoji-id="6156436440260549720">🎖️</tg-emoji> Add Role</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${who(tid)}\n<tg-emoji emoji-id="5334882760735598374">🧾</tg-emoji> Role saat ini: ${currentRoles(tid)}\n\n` +
    `Pilih role yang mau diberikan:` +
    (note ? `\n\n${note}` : "")
  );
}

async function edit(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    });
  } catch (e) {
    if (!/message is not modified/i.test(e?.message || "")) throw e;
  }
}

registerCallback("arole", async (ctx, args) => {
  const [action, uid, tid, val] = args;

  // 1) Tombol hanya untuk user yang mengetik /addrole
  if (String(ctx.from.id) !== String(uid)) {
    return ctx.answerCbQuery("Tombol ini bukan untukmu. Ketik /addrole sendiri.", { show_alert: true });
  }
  // 2) Hak pemanggil dicek ulang (role bisa saja sudah dicabut setelah menu muncul)
  if (!canGrant(ctx.from.id, "mgr2")) {
    return ctx.answerCbQuery("Akses kamu tidak cukup untuk memberi role.", { show_alert: true });
  }

  if (action === "x") {
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Ditutup.");
  }
  if (action === "m") {
    await ctx.answerCbQuery();
    return edit(ctx, mainText(tid), mainKeyboard(uid, tid));
  }
  if (action === "sp" || action === "sr") {
    const isPrem = action === "sp";
    if (!canGrant(ctx.from.id, isPrem ? "mgr" : "mgr2")) {
      return ctx.answerCbQuery("Role ini tidak bisa kamu beri.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    return edit(
      ctx,
      `<b>${isPrem ? "<tg-emoji emoji-id=\"5427168083074628963\">💎</tg-emoji> Premium" : "<tg-emoji emoji-id=\"5431499171045581032\">🛒</tg-emoji> Reseller"}</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${who(tid)}\n\nPilih versi (V1–V${MAX_SLOT}):`,
      slotKeyboard(uid, tid, isPrem ? "p" : "r")
    );
  }

  // Aksi pemberian role
  let spec = null;
  let need = "super";
  let label = "";
  if (action === "f" && FLAT[val]) {
    spec = { op: "add", type: "flat", role: val };
    need = FLAT_GRANT[val];
    label = FLAT[val].label.toUpperCase();
  } else if (action === "p" && SLOTS.includes(val)) {
    spec = { op: "add", type: "prem", slot: val };
    need = "mgr";
    label = `PREMIUM V${val}`;
  } else if (action === "r" && SLOTS.includes(val)) {
    spec = { op: "add", type: "res", slot: val };
    need = "mgr2";
    label = `RESELLER V${val}`;
  } else if (action === "A") {
    spec = { op: "add", type: "all" };
    need = "staff";
    label = "ALL AKSES";
  } else if (action === "P") {
    spec = { op: "add", type: "allprem" };
    need = "staff";
    label = "PREMIUM (semua versi)";
  } else if (action === "R") {
    spec = { op: "add", type: "allres" };
    need = "staff";
    label = "RESELLER (semua versi)";
  }
  if (!spec) return ctx.answerCbQuery();

  if (!canGrant(ctx.from.id, need)) {
    return ctx.answerCbQuery(`Role ini tidak bisa kamu beri. ${GRANT_TEXT[need]}`, { show_alert: true });
  }

  const { changed } = await applyRole(spec, tid);
  await ctx.answerCbQuery(changed ? `${label} diberikan ✓` : "Sudah memiliki role ini.");
  const note = changed ? `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Berhasil menambahkan <b>${h(label)}</b>.` : `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sudah memiliki <b>${h(label)}</b>.`;

  // Premium/Reseller per versi: tetap di daftar versi agar bisa memberi beberapa versi sekaligus
  if (action === "p" || action === "r") {
    return edit(
      ctx,
      `<b>${action === "p" ? "<tg-emoji emoji-id=\"5427168083074628963\">💎</tg-emoji> Premium" : "<tg-emoji emoji-id=\"5431499171045581032\">🛒</tg-emoji> Reseller"}</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${who(tid)}\n<tg-emoji emoji-id="5334882760735598374">🧾</tg-emoji> Role saat ini: ${currentRoles(tid)}\n\n${note}\n\nPilih versi lain atau kembali:`,
      slotKeyboard(uid, tid, action)
    );
  }
  return edit(ctx, mainText(tid, note), mainKeyboard(uid, tid));
});

export default {
  command: ["addrole"],
  category: "add",
  roleCmd: true, // command role: hanya yang boleh memberi role, tidak tersedia di bot clone
  description: "Beri role CPanel & CVPS lewat tombol. Contoh: /addrole 123456789 (atau balas pesan user)",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (!canGrant(ctx.from.id, "mgr2")) {
      return reply(ctx, `❌ Command ini tidak bisa kamu pakai.\n${GRANT_TEXT.mgr2}`);
    }
    const target = resolveTarget(ctx, args);
    if (!target) {
      const p = config.prefix;
      return reply(
        ctx,
        `Contoh: <code>${p}addrole 123456789</code>\n(atau balas pesan user dengan <code>${p}addrole</code>, atau pakai <code>@username</code> bila user pernah memakai bot)`
      );
    }
    return reply(ctx, mainText(target.id), { reply_markup: { inline_keyboard: mainKeyboard(ctx.from.id, target.id) } });
  },
};

import config from "../../config.js";
import { reply, h, resolveTarget } from "../../src/lib/cpanel/util.js";
import { canGrant, rolesOf, revocableRoles, revokeByKey, grantForKey, GRANT_TEXT } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { usersDb } from "../../src/database.js";

// ============================================================
//  /delrole  — satu command untuk mencabut SEMUA role CPanel & CVPS
//  (Developer, Root, Founder, Owner, CEO, TK, PT, Reseller VPS, Premium V1-V20, Reseller V1-V20)
//
//  Alur: /delrole <id | @username | balas pesan>  ->  muncul tombol role milik target.
//  Tombol HANYA bisa diklik oleh user yang mengetik command-nya, dan hanya untuk role
//  yang memang boleh dia cabut (dicek ulang saat tombol ditekan).
//
//  callback_data: drole:<aksi>:<uidPemanggil>:<idTarget>[:<key>]
//    aksi  p = cabut satu role (key), a = cabut semua yang boleh, x = tutup
//    key   f-<role> | p-<slot> | r-<slot>
// ============================================================

const targetName = (id) => {
  const u = usersDb.data.users?.[id];
  return u?.username ? `@${u.username}` : u?.name || id;
};
const who = (id) => `<a href="tg://user?id=${h(id)}">${h(targetName(id))}</a> (<code>${h(id)}</code>)`;

/** Susun teks + keyboard daftar role target (hanya yang boleh dicabut pemanggil) */
function buildMenu(callerId, targetId) {
  const all = rolesOf(targetId);
  const mine = revocableRoles(callerId, targetId);
  const locked = all.length - mine.length;

  if (!all.length) {
    return { text: `ℹ️ ${who(targetId)} tidak punya role CPanel / CVPS.`, keyboard: null };
  }
  if (!mine.length) {
    return { text: `❌ Role milik ${who(targetId)} tidak bisa kamu cabut (level akses kamu kurang).`, keyboard: null };
  }

  const rows = [];
  for (let i = 0; i < mine.length; i += 2) {
    rows.push(mine.slice(i, i + 2).map((r) => ({ text: `${r.label}`, icon_custom_emoji_id: "6129486856212979482", emoji_fallback: "🗑️", callback_data: `drole:p:${callerId}:${targetId}:${r.key}` })));
  }
  if (mine.length > 1) rows.push([{ text: "Cabut Semua", icon_custom_emoji_id: "6269118781331609137", emoji_fallback: "🧹", callback_data: `drole:a:${callerId}:${targetId}` }]);
  rows.push([{ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: `drole:x:${callerId}:${targetId}` }]);

  const text =
    `<b><tg-emoji emoji-id="6129486856212979482">🗑️</tg-emoji> Delete Role</b>\n<tg-emoji emoji-id="5373012449597335010">👤</tg-emoji> ${who(targetId)}\n\n` +
    `Pilih role yang mau dicabut:` +
    (locked ? `\n\n<i>${locked} role lain tidak ditampilkan (di luar wewenangmu).</i>` : "");
  return { text, keyboard: rows };
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

registerCallback("drole", async (ctx, args) => {
  const [action, uid, targetId, key] = args;

  // 1) Tombol hanya untuk user yang mengetik /delrole
  if (String(ctx.from.id) !== String(uid)) {
    return ctx.answerCbQuery("Tombol ini bukan untukmu. Ketik /delrole sendiri.", { show_alert: true });
  }
  // 2) Role pemanggil dicek ulang (bisa saja sudah dicabut setelah menu muncul)
  if (!canGrant(ctx.from.id, "mgr2")) {
    return ctx.answerCbQuery("Akses kamu tidak cukup untuk mencabut role.", { show_alert: true });
  }

  if (action === "x") {
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Ditutup.");
  }

  if (action === "p") {
    if (!canGrant(ctx.from.id, grantForKey(key))) {
      return ctx.answerCbQuery("Role ini tidak bisa kamu cabut.", { show_alert: true });
    }
    const { changed } = await revokeByKey(key, targetId);
    await ctx.answerCbQuery(changed ? "Role dicabut ✓" : "Role sudah tidak ada.");
  } else if (action === "a") {
    let n = 0;
    for (const r of revocableRoles(ctx.from.id, targetId)) n += (await revokeByKey(r.key, targetId)).changed ? 1 : 0;
    await ctx.answerCbQuery(n ? `${n} role dicabut ✓` : "Tidak ada yang dicabut.");
  } else {
    return ctx.answerCbQuery();
  }

  // Segarkan daftar (role yang sudah dicabut hilang dari tombol)
  const { text, keyboard } = buildMenu(ctx.from.id, targetId);
  const sisa = rolesOf(targetId);
  return edit(
    ctx,
    keyboard ? text : `✅ Selesai. ${who(targetId)} ${sisa.length ? "masih punya role lain di luar wewenangmu." : "sekarang tidak punya role CPanel / CVPS."}`,
    keyboard
  );
});

export default {
  command: ["delrole"],
  category: "add",
  roleCmd: true, // command role: hanya yang boleh memberi role, tidak tersedia di bot clone
  description: "Cabut role CPanel & CVPS lewat tombol. Contoh: /delrole 123456789 (atau balas pesan user)",
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
        `Contoh: <code>${p}delrole 123456789</code>\n(atau balas pesan user dengan <code>${p}delrole</code>, atau pakai <code>@username</code> bila user pernah memakai bot)`
      );
    }
    const { text, keyboard } = buildMenu(ctx.from.id, target.id);
    return reply(ctx, text, keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {});
  },
};

import config from "../../config.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { isOwner } from "../../src/middleware.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, table, replyView, replyNote, editCbView } from "../../src/lib/richUi.js";
import {
  ROLE_ORDER, getRoleLimit, checkLimit, setRoleLimit, resetAllLimits, fmtLimit,
} from "../../src/lib/cpanel/limit.js";

registerCallback("cplimit", async (ctx, args) => {
  const [action, uid] = args;
  if (String(ctx.from.id) !== String(uid) || !isOwner(ctx.from.id)) {
    return ctx.answerCbQuery("Khusus owner bot yang menjalankan perintah ini.", { show_alert: true });
  }
  if (action === "yes") {
    await resetAllLimits();
    await editCbView(ctx, note("✅", "Limit direset", "Semua limit dikembalikan ke default dan pemakaian user direset."));
  } else {
    await editCbView(ctx, note("✖️", "Dibatalkan", "Limit tidak diubah."));
  }
  return ctx.answerCbQuery();
});

export default {
  command: ["mylimit", "setlimit", "resetlimit"],
  category: "cpanel",
  description: "Limit pembuatan panel & VPS per role. Contoh: /mylimit, /setlimit reseller 5",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const cmd = cmdName(ctx);
    const p = config.prefix;
    const uid = ctx.from.id;

    if (cmd === "mylimit") {
      const l = checkLimit(uid);
      return replyView(
        ctx,
        title("📊", "Limit Pembuatan Panel &amp; VPS") +
          table(["Info", "Nilai"], [
            ["Role", `<b>${h(l.role.toUpperCase())}</b>`],
            ["Limit", l.limit === null ? "∞ Unlimited" : fmtLimit(l.limit)],
            ["Terpakai", `${l.used}x`],
            ...(l.remaining === null ? [] : [["Sisa", `${l.remaining}x`]]),
          ])
      );
    }

    if (!isOwner(uid)) return replyNote(ctx, "❌", "Akses ditolak", "Perintah ini khusus owner bot.");

    if (cmd === "limitinfo") {
      return replyView(
        ctx,
        title("⌗", "Konfigurasi Limit Panel") +
          table(["Role", "Limit"], [...ROLE_ORDER.map((r) => [r.toUpperCase(), fmtLimit(getRoleLimit(r))]), ["OWNER/DEV/ROOT", "∞ Unlimited"]]) +
          quote(`Ubah: <code>${p}setlimit &lt;role&gt; &lt;angka|unlimited&gt;</code>`, `Reset semua: <code>${p}resetlimit</code>`)
      );
    }

    if (cmd === "setlimit") {
      const role = String(args[0] || "").toLowerCase();
      const val = String(args[1] || "").toLowerCase();
      if (!ROLE_ORDER.includes(role) || !(val === "unlimited" || /^\d+$/.test(val))) {
        return replyNote(ctx, "ℹ️", "Format salah", `Contoh: <code>${p}setlimit reseller 5</code> atau <code>${p}setlimit ceo unlimited</code><br>Role: ${ROLE_ORDER.join(", ")}`);
      }
      await setRoleLimit(role, val);
      return replyNote(ctx, "✅", "Limit diperbarui", `Limit <b>${h(role.toUpperCase())}</b> diatur ke ${val === "unlimited" ? "∞ Unlimited" : val + "x"}.`);
    }

    // resetlimit
    return replyView(
      ctx,
      note("⚠️", "Reset semua limit?", "Semua limit dikembalikan ke default dan pemakaian semua user dihapus."),
      [[
        { text: "Ya, reset", icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "✅", callback_data: `cplimit:yes:${uid}` },
        { text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `cplimit:no:${uid}` },
      ]]
    );
  },
};

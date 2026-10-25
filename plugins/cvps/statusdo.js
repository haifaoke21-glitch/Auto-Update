import { canUseVps } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, table, replyView } from "../../src/lib/richUi.js";
import { configuredDoSlots, accountKeyboard, cbGuard, editCb, doApi, DENY_TEXT, NO_DO_TEXT } from "../../src/lib/cvps/do.js";

const back = (uid) => [[{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `sdo:b:${uid}` }]];
const menuRich = () => title("📊", "Status Digital Ocean") + quote("Pilih akun <b>Digital Ocean</b> untuk melihat statusnya.");

registerCallback("sdo", async (ctx, args) => {
  const [action, uid, slot] = args;
  if (!(await cbGuard(ctx, uid))) return;

  if (action === "b") {
    await editCb(ctx, menuRich(), accountKeyboard((s) => `sdo:a:${uid}:${s}`));
    return ctx.answerCbQuery();
  }

  if (action === "a" || action === "d") {
    await ctx.answerCbQuery();
    try {
      const [{ account }, { droplets = [] }] = await Promise.all([doApi(slot, "GET", "/account"), doApi(slot, "GET", "/droplets?per_page=200")]);
      if (!account?.email) return editCb(ctx, note("✕", "API Key tidak valid", "Akun tidak aktif atau key salah."), back(uid));
      if (action === "a") {
        const active = droplets.filter((d) => d.status === "active").length;
        return editCb(
          ctx,
          title("☁️", `Digital Ocean ${h(slot)}`) +
            table(["Info", "Nilai"], [
              ["📊 Status Akun", h(account.status)],
              ["📦 Limit Droplet", String(account.droplet_limit)],
              ["🟢 VPS Aktif", String(active)],
              ["🧮 Sisa Droplet", String(account.droplet_limit - droplets.length)],
            ]),
          [[{ text: "Info Lengkap", icon_custom_emoji_id: "5231012545799666522", emoji_fallback: "ℹ️", callback_data: `sdo:d:${uid}:${slot}` }], ...back(uid)]
        );
      }
      const off = droplets.filter((d) => d.status !== "active").length;
      return editCb(
        ctx,
        title("ℹ️", `Info Lengkap — DO ${h(slot)}`) +
          table(["Info", "Nilai"], [
            ["✉️ Email", h(account.email)],
            ["🆔 UUID", `<code>${h(account.uuid)}</code>`],
            ["📊 Status", h(account.status)],
            ["📦 Droplet Limit", String(account.droplet_limit)],
            ["✔️ Email Verified", account.email_verified ? "Ya" : "Tidak"],
            ["👥 Team", account.team ? "Ya" : "Tidak"],
            ["⊘ VPS Non-aktif", String(off)],
          ]),
        [[{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `sdo:a:${uid}:${slot}` }]]
      );
    } catch (e) {
      return editCb(ctx, note("⚠️", "Gagal mengambil data dari DigitalOcean", h(e.message)), back(uid));
    }
  }
  return ctx.answerCbQuery();
});

export default {
  command: ["statusdo"],
  category: "cvps",
  description: "Status akun DigitalOcean: limit & jumlah VPS (Reseller VPS+). Contoh: /statusdo",
  cooldown: 3000,
  run: async (ctx) => {
    if (!canUseVps(ctx.from.id)) return replyView(ctx, DENY_TEXT);
    if (!configuredDoSlots().length) return replyView(ctx, NO_DO_TEXT);
    const uid = ctx.from.id;
    return replyView(ctx, menuRich(), accountKeyboard((s) => `sdo:a:${uid}:${s}`));
  },
};

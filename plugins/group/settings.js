import { getGroup } from "../../src/database.js";
import { richSay } from "../../src/lib/groupUtil.js";
import { title, table, quote, editCbView, dropAnim } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { floodCfg } from "../../src/lib/antiFlood.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { MODES, MAX_SLOTS, fsubCfg, activeChannels, cbAdmin } from "../../src/lib/fsub.js";
import { maxWarn } from "./warn.js";

const st = (v) => (v ? `${E.ok} Aktif` : `${E.no} Mati`);

/** Tampilan pengaturan grup + tombol Force Subscribe */
function settingsView(chatId) {
  const g = getGroup(chatId);
  const flood = floodCfg(g.antiflood);
  const f = fsubCfg(g);
  const n = activeChannels(f).length;
  const rich =
    title(E.gear, "Pengaturan Grup") +
    table(["Fitur", "Status"], [
      ["Welcome", st(g.welcome)],
      ["Goodbye", st(g.goodbye)],
      ["Anti Link", st(g.antilink)],
      ["Anti Promosi", st(g.antipromosi)],
      ["Anti Forward", st(g.antiforward)],
      ["Anti Bot", st(g.antibot)],
      ["Anti Admin", st(g.antiadmin)],
      ["Anti Spam", st(g.antispam)],
      ["Anti Flood", flood.on ? `${E.ok} Aktif · ${flood.limit}/${flood.window}s` : `${E.no} Mati`],
      ["Mode Ketat", st(g.modeketat?.on)],
      ["Force Subscribe", f.on ? `${E.ok} Aktif · ${MODES[f.mode].label} · ${n}/${MAX_SLOTS} channel` : `${E.no} Mati${n ? ` · ${n} channel` : ""}`],
      ["Batas warn", `<b>${maxWarn(g)}</b>`],
    ]) +
    quote(`${E.info} Tekan <b>Force Subscribe</b> untuk mengatur channel wajib, mode, dan diagnostik.`);
  const rows = [
    [{ text: "🔒 Force Subscribe", callback_data: "fsub:menu" }],
    [{ text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", callback_data: "gset:x" }],
  ];
  return { rich, rows };
}

export default {
  command: ["settings", "setting", "pengaturan"],
  category: "group",
  description: "Lihat pengaturan grup (welcome, anti-spam, dll) dan buka tombol Force Subscribe",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx) => {
    const v = settingsView(ctx.chat.id);
    await richSay(ctx, v.rich, v.rows);
  },
};

registerCallback("gset", async (ctx, args) => {
  if (!ctx.chat || ctx.chat.type === "private") return ctx.answerCbQuery();
  if (!(await cbAdmin(ctx))) return ctx.answerCbQuery("Khusus admin grup.", { show_alert: true });
  if (args[0] === "x") {
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery();
  }
  const v = settingsView(ctx.chat.id);
  await editCbView(ctx, v.rich, v.rows);
  return ctx.answerCbQuery();
});

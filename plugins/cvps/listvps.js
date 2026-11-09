import { canUseVps } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, para, table, replyView, sendView } from "../../src/lib/richUi.js";
import {
  vpsRegions, configuredDoSlots, accountKeyboard, cbGuard, editCb, listDroplets, getDroplet,
  publicIp, fmtStatus, fmtAge, DENY_TEXT, NO_DO_TEXT,
} from "../../src/lib/cvps/do.js";

const MAX_BTN = 40; // batas tombol per daftar (Telegram maks. 100 tombol)
const menuRich = () => title("☰", "List VPS") + quote("Pilih akun <b>Digital Ocean</b> untuk melihat daftar VPS.");

registerCallback("lvps", async (ctx, args) => {
  const [action, uid, acc, dropletId] = args;
  if (!(await cbGuard(ctx, uid))) return;

  if (action === "b") {
    await editCb(ctx, menuRich(), accountKeyboard((s) => `lvps:l:${uid}:${s}`));
    return ctx.answerCbQuery();
  }

  if (action === "l") {
    await ctx.answerCbQuery();
    const back = [[{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `lvps:b:${uid}` }]];
    try {
      await editCb(ctx, note("⌕", "Mengambil daftar VPS...", "Mohon tunggu sebentar."));
      const list = await listDroplets(acc);
      if (!list.length) return editCb(ctx, note("✉️", "Tidak ada VPS di akun ini", `Digital Ocean ${h(acc)} belum punya VPS.`), back);
      const kb = list.slice(0, MAX_BTN).map((d) => [{
        text: `${d.name} • ${publicIp(d) || "No IP"} • ${fmtStatus(d.status)}`,
        callback_data: `lvps:i:${uid}:${acc}:${d.id}`,
      }]);
      kb.push(back[0]);
      return editCb(
        ctx,
        title("🖥️", "Monitoring VPS") +
          table(["Info", "Nilai"], [
            ["☁️ Akun DO", `<b>${h(acc)}</b>`],
            ["📊 Total VPS", `<b>${list.length}</b>${list.length > MAX_BTN ? ` (menampilkan ${MAX_BTN})` : ""}`],
          ]) +
          para("Klik salah satu VPS di bawah untuk detail:"),
        kb
      );
    } catch (e) {
      return editCb(ctx, note("✕", "Gagal ambil daftar VPS", h(e.message)), back);
    }
  }

  if (action === "i") {
    await ctx.answerCbQuery();
    const chatId = ctx.callbackQuery.message.chat.id;
    try {
      const d = await getDroplet(acc, dropletId);
      const reg = vpsRegions[d.region?.slug] || { flag: "🏳️", name: d.region?.name || "Unknown" };
      return sendView(
        ctx.telegram, chatId,
        title("🖥️", h(d.name)) +
          table(["Detail", "Info"], [
            ["🆔 ID", `<code>${d.id}</code>`],
            ["🌐 IP", `<code>${publicIp(d) || "Belum tersedia"}</code>`],
            ["📦 Spec", h(d.size_slug || "?")],
            ["💿 OS", h(`${d.image?.distribution || "?"} ${d.image?.name || ""}`)],
            ["📍 Region", `${reg.flag} ${h(reg.name)}`],
            ["📊 Status", fmtStatus(d.status)],
            ["⏱️ Umur", d.created_at ? fmtAge(d.created_at) : "-"],
          ]),
        [[
          { text: "Rebuild", icon_custom_emoji_id: "5348125953090403204", emoji_fallback: "🔄", callback_data: `rbld:a:${uid}:${acc}:${d.id}` },
          { text: "Hapus", icon_custom_emoji_id: "6129486856212979482", emoji_fallback: "🗑️", callback_data: `dvps:a:${uid}:${acc}:${d.id}` },
        ]]
      );
    } catch (e) {
      return sendView(ctx.telegram, chatId, note("✕", "Gagal ambil detail VPS", h(e.message)));
    }
  }
  return ctx.answerCbQuery();
});

export default {
  command: ["listvps"],
  category: "cvps",
  description: "Daftar & detail VPS di akun DigitalOcean (Reseller VPS+). Contoh: /listvps",
  cooldown: 3000,
  run: async (ctx) => {
    if (!canUseVps(ctx.from.id)) return replyView(ctx, DENY_TEXT);
    if (!configuredDoSlots().length) return replyView(ctx, NO_DO_TEXT);
    const uid = ctx.from.id;
    return replyView(ctx, menuRich(), accountKeyboard((s) => `lvps:l:${uid}:${s}`));
  },
};

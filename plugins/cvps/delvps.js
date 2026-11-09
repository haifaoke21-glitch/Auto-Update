import config from "../../config.js";
import { canUseVps } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, para, table, replyView, replyNote, dropAnim } from "../../src/lib/richUi.js";
import { configuredDoSlots, accountKeyboard, cbGuard, editCb, getDroplet, deleteDroplet, publicIp, DENY_TEXT, NO_DO_TEXT } from "../../src/lib/cvps/do.js";

registerCallback("dvps", async (ctx, args) => {
  const [action, uid, acc, dropletId] = args;
  if (!(await cbGuard(ctx, uid))) return;

  if (action === "n") {
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Delete VPS dibatalkan.");
  }

  // akun dipilih -> minta konfirmasi
  if (action === "a") {
    await ctx.answerCbQuery();
    try {
      const d = await getDroplet(acc, dropletId);
      return editCb(
        ctx,
        title("⚠️", "Konfirmasi Delete VPS") +
          table(["Info", "Detail"], [
            ["🏷️ Name", `<b>${h(d.name)}</b>`],
            ["🆔 ID", `<code>${dropletId}</code>`],
            ["🌐 IP", `<code>${publicIp(d) || "No IP"}</code>`],
          ]) +
          quote("<tg-emoji emoji-id=\"5400256157300323171\">❗</tg-emoji> <b>PERINGATAN</b>", "• Semua data akan hilang permanen", "• VPS tidak dapat dikembalikan", "• Proses delete tidak bisa dibatalkan") +
          para("Yakin ingin menghapus VPS ini?"),
        [[{ text: "✓ Ya, Hapus", callback_data: `dvps:y:${uid}:${acc}:${dropletId}` }, { text: "✕ Batal", callback_data: `dvps:n:${uid}` }]]
      );
    } catch (e) {
      return editCb(ctx, note("✕", "Gagal ambil info VPS", h(e.message)));
    }
  }

  if (action === "y") {
    await ctx.answerCbQuery();
    try {
      await deleteDroplet(acc, dropletId);
      return editCb(ctx, note("✓", "VPS berhasil dihapus", `Droplet <code>${dropletId}</code> sudah dihapus.`));
    } catch (e) {
      return editCb(ctx, note("✕", "Gagal delete VPS", h(e.message)));
    }
  }
  return ctx.answerCbQuery();
});

export default {
  command: ["delvps"],
  category: "cvps",
  description: "Hapus VPS DigitalOcean permanen (Reseller VPS+). Contoh: /delvps 123456789",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (!canUseVps(ctx.from.id)) return replyView(ctx, DENY_TEXT);
    const id = String(args[0] || "").trim();
    if (!/^\d+$/.test(id)) {
      return replyNote(ctx, "ℹ️", "Format salah", `Contoh: <code>${config.prefix}delvps 123456789</code><br>(ID droplet, lihat di <code>${config.prefix}listvps</code>)`);
    }
    if (!configuredDoSlots().length) return replyView(ctx, NO_DO_TEXT);
    const uid = ctx.from.id;
    return replyView(
      ctx,
      title("🗑️", "Delete VPS") + table(["Info", "Detail"], [["🆔 Droplet", `<code>${id}</code>`]]) + para("Pilih akun Digital Ocean:"),
      accountKeyboard((s) => `dvps:a:${uid}:${s}:${id}`)
    );
  },
};

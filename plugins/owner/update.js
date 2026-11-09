import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import { isCloneCtx } from "../../src/lib/cloneGuard.js";
import { sendView, replyView, editView } from "../../src/lib/richUi.js";
import { restartProcess } from "../../src/lib/restart.js";
import { checkForUpdate, applyUpdate, isConfigured, isUpdating, localVersion, getCfg, setPendingNotice, V } from "../../src/lib/updater.js";

/**
 * Jalankan update. Semua tampilan memakai Rich Message + TG emoji (pemilik bot tidak premium -> emoji biasa otomatis).
 * editId: bila dipanggil dari tombol "Update Sekarang", pesan itu diedit jadi progres -> hasil (tidak kirim pesan baru).
 */
async function runUpdate(telegram, chatId, userId, { force = false, editId = null } = {}) {
  let msgId = editId;
  const show = async (v) => {
    if (msgId) {
      try { return await editView(telegram, chatId, msgId, v.rich, v.rows); } catch { msgId = null; }
    }
    const m = await sendView(telegram, chatId, v.rich, v.rows).catch(() => null);
    msgId = m?.message_id || null;
  };

  if (!isConfigured()) return show(V.notConfigured());
  if (isUpdating()) return show(V.busy());
  await show(V.checking());
  try {
    const r = await applyUpdate({ force });
    if (r.status === "uptodate") {
      const c = getCfg();
      return show(V.upToDate({ version: r.from, repo: c.repo, branch: c.branch, hint: true }));
    }
    setPendingNotice(chatId, { by: userId });
    await show(V.done(r));
    // Panel Pterodactyl butuh kode keluar non-0 agar menyalakan ulang (lihat src/lib/restart.js)
    restartProcess(1500);
  } catch (e) {
    await show(V.failed(e.message));
  }
}

registerCallback("upd", async (ctx, [action]) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });
  if (action !== "go") return ctx.answerCbQuery();
  await ctx.answerCbQuery("Memulai update...");
  await runUpdate(ctx.telegram, ctx.chat.id, ctx.from.id, { editId: ctx.callbackQuery?.message?.message_id || null });
});

export default {
  command: ["update", "cekupdate"],
  category: "owner",
  description: "Cek & pasang update script dari GitHub (/cekupdate hanya cek, /update pasang, /update force pasang ulang)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const reply = (v) => replyView(ctx, v.rich, v.rows);
    if (isCloneCtx(ctx)) return reply(V.cloneLocked());
    const cmd = (ctx.message?.text || "").trim().replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();

    if (cmd === "cekupdate") {
      if (!isConfigured()) return reply(V.notConfigured());
      try {
        const r = await checkForUpdate();
        const c = getCfg();
        return reply(r.hasUpdate ? V.available(r) : V.upToDate({ version: r.local || localVersion(), repo: c.repo, branch: c.branch }));
      } catch (e) {
        return reply(V.checkFailed(e.message));
      }
    }

    return runUpdate(ctx.telegram, ctx.chat.id, ctx.from.id, { force: (args[0] || "").toLowerCase() === "force" });
  },
};

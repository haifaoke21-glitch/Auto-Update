import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import { isCloneCtx } from "../../src/lib/cloneGuard.js";
import { checkForUpdate, applyUpdate, isConfigured, isUpdating, localVersion, getCfg, setPendingNotice } from "../../src/lib/updater.js";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function runUpdate(telegram, chatId, userId, force = false) {
  const send = (t) => telegram.sendMessage(chatId, t, { parse_mode: "HTML" }).catch(() => {});
  if (!isConfigured()) {
    return send("❌ Auto update belum aktif. Isi <code>autoUpdate.repo</code> di <code>config.js</code> (contoh: <code>\"username/nama-repo\"</code>).");
  }
  if (isUpdating()) return send("⏳ Update sedang berjalan, tunggu sebentar.");
  await send("⏳ Memeriksa dan mengunduh update dari GitHub...");
  try {
    const r = await applyUpdate({ force });
    if (r.status === "uptodate") {
      return send(`✅ Script sudah versi terbaru (<code>${esc(r.from)}</code>). Pakai <code>/update force</code> untuk memasang ulang paksa.`);
    }
    const log = r.changelog?.length ? "\n\n<b>Yang baru:</b>\n" + r.changelog.map((l) => `• ${esc(l)}`).join("\n") : "";
    setPendingNotice(chatId, { by: userId });
    await send(
      `✅ <b>Update berhasil</b>\n<code>${esc(r.from)}</code> → <code>${esc(r.to)}</code>\n` +
        `${r.changed} file diperbarui${r.removed ? `, ${r.removed} file lama dihapus` : ""}${r.npm ? ", dependency diinstall ulang" : ""}.` +
        log +
        `\n\n🔄 Bot restart otomatis...`
    );
    // Exit code 0 supaya panel / pm2 / systemd menyalakan ulang proses (sama seperti /restart).
    setTimeout(() => process.exit(0), 1500);
  } catch (e) {
    await send(`❌ <b>Update gagal</b>, file dikembalikan seperti semula.\n<code>${esc(e.message)}</code>`);
  }
}

registerCallback("upd", async (ctx, [action]) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });
  if (action !== "go") return ctx.answerCbQuery();
  await ctx.answerCbQuery("Memulai update...");
  await runUpdate(ctx.telegram, ctx.chat.id, ctx.from.id);
});

export default {
  command: ["update", "cekupdate"],
  category: "owner",
  description: "Cek & pasang update script dari GitHub (/cekupdate hanya cek, /update pasang, /update force pasang ulang)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const html = (t, extra) => ctx.reply(t, { parse_mode: "HTML", ...extra });
    if (isCloneCtx(ctx)) return html("🔒 Update hanya bisa dilakukan lewat bot utama.");
    const cmd = (ctx.message?.text || "").trim().replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();

    if (cmd === "cekupdate") {
      if (!isConfigured()) return html("❌ Auto update belum aktif. Isi <code>autoUpdate.repo</code> di <code>config.js</code>.");
      try {
        const r = await checkForUpdate();
        const c = getCfg();
        return html(
          r.hasUpdate
            ? `🔔 Ada update: <code>${esc(r.local)}</code> → <code>${esc(r.remote.version)}</code>\nKetik /update untuk memasang.`
            : `✅ Sudah versi terbaru: <code>${esc(r.local)}</code>\nRepo: <code>${esc(c.repo)}@${esc(c.branch)}</code>`
        );
      } catch (e) {
        return html(`❌ Gagal cek update: <code>${esc(e.message)}</code>`);
      }
    }

    return runUpdate(ctx.telegram, ctx.chat.id, ctx.from.id, (args[0] || "").toLowerCase() === "force");
  },
};

import config from "../../config.js";
import { canUseVps } from "../../src/lib/cpanel/roles.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, para, table, replyView, replyNote, editView, dropAnim } from "../../src/lib/richUi.js";
import {
  REBUILD_OS, configuredDoSlots, accountKeyboard, cbGuard, editCb, getDroplet, rebuildDroplet, publicIp, DENY_TEXT, NO_DO_TEXT,
} from "../../src/lib/cvps/do.js";

async function rebuildJob(ctx, { chatId, msgId, acc, dropletId, os }) {
  const edit = (rich) => editView(ctx.telegram, chatId, msgId, rich).catch(() => {});
  try {
    const res = await rebuildDroplet(acc, dropletId, os.slug);
    await edit(
      title("🔄", "Rebuild Dimulai!") +
        table(["Info", "Detail"], [
          ["🆔 ID", `<code>${dropletId}</code>`],
          ["☁️ Akun DO", h(acc)],
          ["💿 OS", `<b>${h(os.name)}</b>`],
          ["📊 Status", h(res.action?.status || "in-progress")],
        ]) +
        quote("<i>Tunggu ±1 menit...</i>")
    );
    await new Promise((r) => setTimeout(r, 60000));
    const d = await getDroplet(acc, dropletId);
    await edit(
      title("✅", "Rebuild Selesai!") +
        table(["Info", "Detail"], [
          ["🆔 ID", `<code>${dropletId}</code>`],
          ["🌐 IP", `<code>${publicIp(d) || "IP belum muncul"}</code>`],
          ["💿 OS", `<b>${h(`${d.image?.distribution || ""} ${d.image?.name || os.name}`.trim())}</b>`],
        ])
    );
  } catch (e) {
    await edit(note("✕", "Rebuild gagal", h(e.message)));
  }
}

registerCallback("rbld", async (ctx, args) => {
  const [action, uid, acc, dropletId, idx] = args;
  if (!(await cbGuard(ctx, uid))) return;

  if (action === "x") {
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Rebuild dibatalkan.");
  }

  // akun dipilih -> pilih OS
  if (action === "a") {
    const kb = [];
    for (let i = 0; i < REBUILD_OS.length; i += 2) {
      kb.push(REBUILD_OS.slice(i, i + 2).map((o, j) => ({ text: o.name, callback_data: `rbld:c:${uid}:${acc}:${dropletId}:${i + j}` })));
    }
    kb.push([{ text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `rbld:x:${uid}` }]);
    await editCb(
      ctx,
      title("⚒️", "Rebuild VPS") + table(["Info", "Detail"], [["🆔 Droplet", `<code>${dropletId}</code>`], ["☁️ Akun DO", h(acc)]]) + para("Pilih OS baru:"),
      kb
    );
    return ctx.answerCbQuery();
  }

  // OS dipilih -> konfirmasi
  if (action === "c") {
    const os = REBUILD_OS[Number(idx)];
    if (!os) return ctx.answerCbQuery();
    await editCb(
      ctx,
      title("⚠️", "Konfirmasi Rebuild") +
        table(["Info", "Detail"], [["🆔 Droplet", `<code>${dropletId}</code>`], ["💿 OS baru", `<b>${h(os.name)}</b>`]]) +
        quote("❗ Semua data di VPS akan dihapus dan diganti OS baru. Tidak bisa dibatalkan."),
      [[{ text: "✓ Ya, Rebuild", callback_data: `rbld:y:${uid}:${acc}:${dropletId}:${idx}` }, { text: "✕ Batal", callback_data: `rbld:x:${uid}` }]]
    );
    return ctx.answerCbQuery();
  }

  if (action === "y") {
    const os = REBUILD_OS[Number(idx)];
    if (!os) return ctx.answerCbQuery();
    await ctx.answerCbQuery("Memproses rebuild...");
    const msg = ctx.callbackQuery.message;
    await editCb(ctx, note("⏳", "Rebuild sedang diproses...", "Mohon tunggu."));
    // Latar belakang: menunggu 60 detik tidak boleh menahan handler callback
    rebuildJob(ctx, { chatId: msg.chat.id, msgId: msg.message_id, acc, dropletId, os }).catch((e) => console.error("[CVPS]", e));
    return;
  }
  return ctx.answerCbQuery();
});

export default {
  command: ["rebuild"],
  category: "cvps",
  description: "Install ulang OS VPS DigitalOcean (Reseller VPS+). Contoh: /rebuild 123456789",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (!canUseVps(ctx.from.id)) return replyView(ctx, DENY_TEXT);
    const id = String(args[0] || "").trim();
    if (!/^\d+$/.test(id)) return replyNote(ctx, "⚠️", "Format salah", `Contoh: <code>${config.prefix}rebuild 123456789</code>`);
    if (!configuredDoSlots().length) return replyView(ctx, NO_DO_TEXT);
    const uid = ctx.from.id;
    return replyView(
      ctx,
      title("⚒️", "Rebuild VPS") + table(["Info", "Detail"], [["🆔 Droplet", `<code>${id}</code>`]]) + para("Pilih akun Digital Ocean:"),
      accountKeyboard((s) => `rbld:a:${uid}:${s}:${id}`)
    );
  },
};

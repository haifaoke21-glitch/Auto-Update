import config from "../../config.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { h, title, quote, table, replyView, replyNote } from "../../src/lib/richUi.js";
import { DO_SLOTS, isDoSlot, getDoKey, setDoKey, removeDoKey, checkDoKey } from "../../src/lib/cvps/do.js";

export default {
  command: ["setdo", "deldo"],
  category: "cvps",
  description: "Atur API Key DigitalOcean slot 1–10 (Owner Bot). Contoh: /setdo 1 dop_v1_xxx",
  ownerOnly: true,
  privateOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const p = config.prefix;
    const cmd = cmdName(ctx);

    // Hapus: /setdo hapus 2  atau  /deldo 2
    if (cmd === "deldo" || /^(hapus|del|delete)$/i.test(args[0] || "")) {
      const slot = String(cmd === "deldo" ? args[0] : args[1] || "");
      if (!isDoSlot(slot)) return replyNote(ctx, "ℹ️", "Format salah", `Contoh: <code>${p}deldo 2</code>`);
      return (await removeDoKey(slot))
        ? replyNote(ctx, "🗑️", "API Key dihapus", `API Key DO slot ${slot} dihapus.`)
        : replyNote(ctx, "⚠️", "Slot kosong", "Slot itu memang belum diatur.");
    }

    // Tanpa argumen: status slot (API key tidak ditampilkan)
    if (!args.length) {
      return replyView(
        ctx,
        title("☁️", "Slot Digital Ocean") +
          table(["Slot", "Status"], DO_SLOTS.map((s) => [`DO ${s}`, getDoKey(s) ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> <b>terisi</b>" : "▫️ kosong"])) +
          quote(`Atur: <code>${p}setdo 1 &lt;api_key&gt;</code>`, `Hapus: <code>${p}deldo 2</code>`, "<i>Pesan berisi API key otomatis dihapus dari chat.</i>")
      );
    }

    const slot = String(args[0]);
    const key = String(args[1] || "").trim();
    if (!isDoSlot(slot) || !key) return replyNote(ctx, "ℹ️", "Format salah", `<code>${p}setdo &lt;slot 1-10&gt; &lt;api_key&gt;</code>`);
    // API key sudah terlanjur diketik: hapus pesannya dari chat
    await ctx.deleteMessage().catch(() => {});
    try {
      const acc = await checkDoKey(key);
      await setDoKey(slot, key, acc?.email || "");
      return replyView(
        ctx,
        title("✅", `API Key DO Slot ${h(slot)} Tersimpan`) +
          table(["Info", "Detail"], [["✉️ Akun", h(acc?.email || "-")], ["📊 Status", h(acc?.status || "-")]]) +
          quote("<i>Pesan berisi API key sudah dihapus dari chat.</i>")
      );
    } catch (e) {
      return replyNote(ctx, "✕", "API Key ditolak DigitalOcean", `${h(e.message)}<br>Cek lagi key-nya lalu ulangi.`);
    }
  },
};

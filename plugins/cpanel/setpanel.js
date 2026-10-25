import config from "../../config.js";
import { h, title, quote, table, replyView, replyNote } from "../../src/lib/richUi.js";
import {
  PANEL_SLOTS, isValidSlot, getPanel, setPanel, removePanel, slotName, getActiveSlot, api,
} from "../../src/lib/cpanel/ptero.js";

export default {
  command: ["setpanel"],
  category: "cpanel",
  description: "Atur domain & API key panel V1–V20 (Owner Bot). Contoh: /setpanel 1 https://panel.com ptla_xxx ptlc_xxx",
  ownerOnly: true,
  privateOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const p = config.prefix;

    // Tanpa argumen: tampilkan status semua slot (API key tidak ditampilkan)
    if (!args.length) {
      const rows = PANEL_SLOTS.filter((s) => getPanel(s)).map((s) => [
        `${String(s) === getActiveSlot() ? "<tg-emoji emoji-id=\"5348125953090403204\">▶️</tg-emoji>" : "•"} <b>${h(slotName(s))}</b>`,
        h(getPanel(s).domain),
      ]);
      return replyView(
        ctx,
        title("🧩", "Slot Panel") +
          (rows.length ? table(["Panel", "Domain"], rows) : "<p><i>Belum ada panel yang diatur.</i></p>") +
          quote(
            `Atur: <code>${p}setpanel 1 https://panel.domain.com ptla_xxx ptlc_xxx</code>`,
            `Hapus: <code>${p}setpanel hapus 2</code>`,
            `Slot: 1–20 dan <code>adp</code>. <tg-emoji emoji-id="5348125953090403204">▶️</tg-emoji> = panel aktif untuk perintah kelola (<code>${p}panel N</code>).`
          )
      );
    }

    if (/^(hapus|del|delete)$/i.test(args[0])) {
      const slot = String(args[1] || "").toLowerCase();
      if (!isValidSlot(slot)) return replyNote(ctx, "ℹ️", "Format salah", `Contoh: <code>${p}setpanel hapus 2</code>`);
      return (await removePanel(slot))
        ? replyNote(ctx, "🗑️", "Panel dihapus", `${h(slotName(slot))} dihapus.`)
        : replyNote(ctx, "⚠️", "Slot kosong", "Slot itu memang belum diatur.");
    }

    const [slotRaw, domain, plta, pltc = ""] = args;
    const slot = String(slotRaw).toLowerCase();
    if (!isValidSlot(slot) || !domain || !plta) {
      return replyNote(ctx, "ℹ️", "Format salah", `<code>${p}setpanel &lt;slot&gt; &lt;domain&gt; &lt;plta&gt; [pltc]</code><br>Slot: 1–20 atau adp.`);
    }
    // API key sudah terlanjur diketik: hapus pesannya dari chat
    await ctx.deleteMessage().catch(() => {});
    try {
      await setPanel(slot, { domain, plta, pltc });
    } catch (e) {
      return replyNote(ctx, "✕", "Gagal menyimpan panel", h(e.message));
    }
    const test = await api(slot, "GET", "/servers?per_page=1");
    return replyView(
      ctx,
      title("✅", `${h(slotName(slot))} Disimpan`) +
        table(["Info", "Status"], [
          ["🌐 Domain", h(getPanel(slot).domain)],
          ["🔌 Koneksi API", test.ok ? "🟢 Berhasil" : `⚠️ Gagal: ${h(test.error)}`],
        ]) +
        quote(...(test.ok ? [] : ["Periksa domain &amp; PLTA (Application API key)."]), "<i>Pesan berisi API key sudah dihapus dari chat.</i>")
    );
  },
};

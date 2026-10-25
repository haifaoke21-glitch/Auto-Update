import config from "../../config.js";
import { isDisko, setDisko } from "../../src/lib/btnAnim.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import { title, table, quote, replyView, editCbView } from "../../src/lib/richUi.js";

// Emoji premium (tg-emoji)
const E = {
  palette: `<tg-emoji emoji-id="5395444784611480792">🎨</tg-emoji>`,
  ok: `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>`,
  no: `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>`,
  gear: `<tg-emoji emoji-id="5341715473882955310">⚙️</tg-emoji>`,
  party: `<tg-emoji emoji-id="6327875261085783004">🎉</tg-emoji>`,
  spark: `<tg-emoji emoji-id="6123129707614441341">✨</tg-emoji>`,
  bulb: `<tg-emoji emoji-id="6334767764472858206">💡</tg-emoji>`,
};

/** Kartu Rich Message: judul + tabel status + catatan */
const view = (on, headline, note) =>
  title(E.palette, "Mode Disko") +
  table(
    [`${E.gear} Pengaturan`, "Status"],
    [
      ["Disko", on ? `${E.ok} <b>AKTIF</b>` : `${E.no} <b>nonaktif</b>`],
      ["Warna tombol", on ? `${E.party} berganti tiap <b>3 detik</b>` : "tetap (biru)"],
      ["Tampilan", "satu warna serempak, tidak campur"],
    ]
  ) +
  quote(headline, ...(note ? [note] : []));

/** Tombol tunggal: belum on -> "Online" (menyalakan); sudah on -> "Offline" (mematikan) */
const rows = (on) => [[on ? { text: "Offline", icon_custom_emoji_id: "5411225014148014586", emoji_fallback: "🔴", callback_data: "disko:off" } : { text: "Online", icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "🟢", callback_data: "disko:on" }]];

const statusView = (on) => view(on, `${E.bulb} <b>Tekan tombol di bawah</b>`, on ? "Tekan <b>Offline</b> untuk mematikan disko." : "Tekan <b>Online</b> untuk menyalakan disko.");
const doneView = (on) =>
  view(
    on,
    `${E.ok} <b>Mode disko ${on ? "diaktifkan" : "dinonaktifkan"}</b>`,
    on ? `${E.spark} Buka menu baru untuk melihat warna tombol berganti.` : "Warna tombol sekarang tetap dan tidak berubah."
  );

// Tombol Online / Offline (khusus owner)
registerCallback("disko", async (ctx, args) => {
  if (!isOwner(ctx.from?.id)) return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });
  const on = args[0] === "on";
  await setDisko(on);
  try {
    await editCbView(ctx, doneView(on), rows(on));
  } catch (err) {
    if (!/not modified/i.test(err?.message || "")) throw err;
  }
  return ctx.answerCbQuery(on ? "Disko ON" : "Disko OFF");
});

export default {
  command: ["disko"],
  category: "owner",
  description: "Mode disko: ketik /disko lalu tekan tombol Online / Offline (warna tombol berganti tiap 3 detik saat on)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const mode = args[0]?.toLowerCase();
    // Cara cepat tanpa tombol: /disko on | off
    if (mode === "on" || mode === "off") {
      await setDisko(mode === "on");
      return replyView(ctx, doneView(mode === "on"), rows(mode === "on"));
    }
    // Cukup /disko: tampil status + tombol Online (jika belum on) / Offline (jika sudah on)
    return replyView(ctx, statusView(isDisko()), rows(isDisko()));
  },
};

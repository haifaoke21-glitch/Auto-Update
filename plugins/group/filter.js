import { getGroup, saveGroup } from "../../src/database.js";
import { esc, richSay, card } from "../../src/lib/groupUtil.js";
import { note, quote, table, fold } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { buildEntry, sendFilter, describeEntry, MAX_FILTERS } from "../../src/lib/filterCore.js";

const usage = () =>
  note(E.info, "Cara pakai /filter", "Buat balasan otomatis: kalau ada yang mengirim kata kunci, bot membalas dengan isi filter.") +
  table(["Jenis", "Cara"], [
    ["<b>Teks</b>", "<code>/filter halo Halo {mention}, selamat datang!</code>"],
    ["<b>Media</b>", "Balas pesannya dengan <code>/filter kata</code>, atau kirim media dengan caption <code>/filter kata teks</code>. Bisa foto, video, GIF, file, stiker, audio, voice note, atau video bulat."],
    ["<b>Beberapa kata</b>", "<code>/filter \"selamat pagi\" Pagi juga!</code>"],
  ]) +
  fold(
    `${E.note} Format & variabel`,
    "Teks mendukung format Telegram (tebal, miring, kutipan, <tg-spoiler>spoiler</tg-spoiler>, dll), Rich Message, tombol, dan variabel — sama seperti /welcome (ketik <code>/welcome help</code>).",
    "Bisa juga membalas pesan yang sudah berformat dengan <code>/filter kata</code> — format, emoji premium, kutipan, spoiler, dan tombol link di pesan itu ikut tersalin. Foto + Rich Message tampil jadi satu pesan."
  ) +
  quote("Daftar filter: <code>/filters</code> · Hapus satu: <code>/stop kata</code> · Hapus semua: <code>/stop</code>");

export default {
  command: ["filter"],
  category: "group",
  description: "Buat balasan otomatis untuk kata kunci (teks, foto, video, file, dll; mendukung Rich Message, kutipan, spoiler & tombol). Contoh: /filter halo Halo {mention}! atau balas pesan lalu /filter kata",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx) => {
    const r = buildEntry(ctx.message);
    if (r.usage) return richSay(ctx, usage());
    if (r.error) return card(ctx, E.no, "Filter tidak dibuat", esc(r.error));

    const filters = { ...(getGroup(ctx.chat.id).filters || {}) };
    const exists = Boolean(filters[r.key]);
    if (!exists && Object.keys(filters).length >= MAX_FILTERS) {
      return card(ctx, E.no, "Batas filter tercapai", `Maksimal <b>${MAX_FILTERS}</b> filter per grup. Hapus yang tidak dipakai dengan <code>/stop kata</code>.`);
    }

    // Kirim contoh dulu; hanya disimpan kalau Telegram menerimanya
    try {
      try {
        await sendFilter(ctx, r.entry, { replyTo: ctx.message.message_id });
      } catch (e1) {
        // Rich Message hasil baca ditolak -> coba salin pesan aslinya
        if (r.entry.src && r.entry.type === "text") {
          r.entry = { ...r.entry, type: "copy", tpl: r.entry.tpl?.buttons?.length ? { v: 2, rich: null, legacy: "", buttons: r.entry.tpl.buttons } : null };
          await sendFilter(ctx, r.entry, { replyTo: ctx.message.message_id });
        } else throw e1;
      }
    } catch (e) {
      const why = String(e?.description || e?.message || e).replace(/^\d+:\s*/, "").replace(/^Bad Request:\s*/i, "").slice(0, 200);
      return richSay(ctx, note(E.no, "Telegram menolak format ini", "Filter belum disimpan.") + quote(`<code>${esc(why)}</code>`));
    }

    filters[r.key] = r.entry;
    await saveGroup(ctx.chat.id, { filters });
    await richSay(ctx, note(E.ok, `Filter ${exists ? "diperbarui" : "disimpan"}`, `Kata kunci: <b>${esc(r.key)}</b> · Jenis: ${esc(describeEntry(r.entry))}`) + quote("Pesan di atas adalah contoh tampilannya.", ...(r.entry.type === "copy" ? [`${E.warn} Filter ini menyalin pesan aslinya — <b>jangan hapus pesan yang dibalas tadi</b>, atau filter berhenti bekerja.`] : [])));
  },
};

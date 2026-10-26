import { getGroup, saveGroup } from "../../src/database.js";
import { esc, card } from "../../src/lib/groupUtil.js";
import { E } from "../../src/lib/emo.js";
import { parseKeyword } from "../../src/lib/filterCore.js";

export default {
  command: ["stop"],
  category: "group",
  description: "Hapus filter. /stop kata = hapus satu filter, /stop all = hapus SEMUA filter. Contoh: /stop halo",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx) => {
    const filters = getGroup(ctx.chat.id).filters || {};
    const total = Object.keys(filters).length;
    if (!total) return card(ctx, E.info, "Belum ada filter", "Belum ada filter di grup ini.");

    const raw = ctx.message.text ?? ctx.message.caption ?? "";
    const cmd = /^\S+/.exec(raw);
    const pk = parseKeyword(raw, cmd ? cmd[0].length : 0);
    if (pk?.error) return card(ctx, E.no, "Kata kunci tidak valid", esc(pk.error));

    // Tanpa argumen sama sekali → minta konfirmasi pakai /stop all
    if (!pk) {
      return card(
        ctx,
        E.info,
        "Konfirmasi hapus semua",
        `Ada <b>${total}</b> filter di grup ini.\n\n` +
        `Untuk menghapus <b>semua</b> filter, ketik:\n<code>/stop all</code>\n\n` +
        `Atau hapus satu filter dengan:\n<code>/stop kata_kunci</code>\n\n` +
        `Lihat daftar: <code>/filters</code>`
      );
    }

    // /stop all atau /stop semua (tanpa kutip) = hapus semua
    const wantAll = !pk.quoted && ["all", "semua"].includes(pk.key);
    if (wantAll) {
      await saveGroup(ctx.chat.id, { filters: {} });
      return card(ctx, E.ok, "Semua filter dihapus", `<b>${total}</b> filter dihapus dari grup ini.`);
    }

    // Hapus satu filter
    if (!filters[pk.key]) {
      return card(ctx, E.no, "Filter tidak ditemukan", `Filter <b>${esc(pk.key)}</b> tidak ada. Lihat daftarnya dengan <code>/filters</code>.`);
    }
    const next = { ...filters };
    delete next[pk.key];
    await saveGroup(ctx.chat.id, { filters: next });
    await card(ctx, E.ok, "Filter dihapus", `Filter <b>${esc(pk.key)}</b> dihapus.${Object.keys(next).length ? "" : " Sudah tidak ada filter tersisa."}`);
  },
};

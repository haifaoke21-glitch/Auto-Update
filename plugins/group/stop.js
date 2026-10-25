import { getGroup, saveGroup } from "../../src/database.js";
import { esc, card } from "../../src/lib/groupUtil.js";
import { E } from "../../src/lib/emo.js";
import { parseKeyword } from "../../src/lib/filterCore.js";

export default {
  command: ["stop"],
  category: "group",
  description: "Hapus filter. /stop = hapus SEMUA filter di grup, /stop kata = hapus satu filter. Contoh: /stop halo",
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

    // Tanpa kata kunci (atau "all" / "semua") = hapus semua. Pakai tanda kutip ("all") untuk filter yang kata kuncinya memang "all".
    const wantAll = !pk || (!pk.quoted && ["all", "semua"].includes(pk.key) && !filters[pk.key]);
    if (wantAll) {
      await saveGroup(ctx.chat.id, { filters: {} });
      return card(ctx, E.ok, "Semua filter dihapus", `<b>${total}</b> filter dihapus dari grup ini.`);
    }

    if (!filters[pk.key]) {
      return card(ctx, E.no, "Filter tidak ditemukan", `Filter <b>${esc(pk.key)}</b> tidak ada. Lihat daftarnya dengan <code>/filters</code>.`);
    }
    const next = { ...filters };
    delete next[pk.key];
    await saveGroup(ctx.chat.id, { filters: next });
    await card(ctx, E.ok, "Filter dihapus", `Filter <b>${esc(pk.key)}</b> dihapus.${Object.keys(next).length ? "" : " Sudah tidak ada filter tersisa."}`);
  },
};

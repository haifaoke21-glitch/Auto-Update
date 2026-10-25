import { richSay, card } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { reloadCache } from "../../src/lib/fsub.js";

export default {
  command: ["reload"],
  category: "group",
  description: "Refresh cache admin grup & hasil cek Force Subscribe (pakai setelah ganti admin / bot dijadikan admin channel)",
  adminOnly: true,
  groupOnly: true,
  cooldown: 5000,
  run: async (ctx) => {
    const n = await reloadCache(ctx.telegram, ctx.chat.id);
    if (n === null) return card(ctx, E.no, "Gagal memuat ulang", "Bot tidak bisa membaca daftar admin. Pastikan bot ada di grup dan sudah jadi admin.");
    await richSay(ctx, note(E.ok, "Cache dimuat ulang", `Daftar admin diperbarui: <b>${n}</b> admin.`) + quote("Cache hasil cek join channel juga sudah dikosongkan."));
  },
};

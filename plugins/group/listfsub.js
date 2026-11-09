import { esc, richSay } from "../../src/lib/groupUtil.js";
import { title, table, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { MODES, MAX_SLOTS, getFsub, activeChannels } from "../../src/lib/fsub.js";

export default {
  command: ["listfsub"],
  category: "group",
  description: "Lihat channel wajib subscribe, mode, dan status Force Subscribe grup ini",
  groupOnly: true,
  cooldown: 5000,
  run: async (ctx) => {
    const cfg = getFsub(ctx.chat.id);
    const chs = activeChannels(cfg);
    const head = table(["Pengaturan", "Nilai"], [
      [`${E.gear} Status`, cfg.on ? `<b>AKTIF</b> ${E.ok}` : `<b>nonaktif</b> ${E.no}`],
      [`${E.deny} Mode`, `<b>${MODES[cfg.mode].label}</b>`],
      [`${E.list} Channel`, `<b>${chs.length}</b> / ${MAX_SLOTS}`],
    ]);
    if (!chs.length) {
      return richSay(ctx, title(E.list, "Daftar Force Subscribe") + head + quote(`${E.info} Belum ada channel. Admin bisa memasang dengan <code>/setfsub 1 @channel</code>.`));
    }
    const rows = chs.map(([s, c]) => [`<b>${s}</b>`, `<a href="${esc(c.link)}">${esc(c.title || c.username || c.id)}</a>${c.username ? `<br>@${esc(c.username)}` : ""}`]);
    await richSay(
      ctx,
      title(E.list, "Daftar Force Subscribe") + head + table(["Slot", "Channel"], rows) + quote(`${E.note} ${esc(MODES[cfg.mode].desc)}`)
    );
  },
};

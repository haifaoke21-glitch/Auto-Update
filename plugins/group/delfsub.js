import { esc, richSay, card } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { MAX_SLOTS, getFsub, patchFsub, activeChannels, clearChatCache } from "../../src/lib/fsub.js";

export default {
  command: ["delfsub"],
  category: "group",
  description: "Hapus channel wajib subscribe dari slot. Contoh: /delfsub 1 | /delfsub all",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const cfg = getFsub(ctx.chat.id);
    const arg = (args[0] || "").toLowerCase();
    if (!arg) {
      return richSay(ctx, note(E.info, "Hapus channel wajib", "Sebutkan nomor slot, atau <code>all</code> untuk semuanya.") + quote("Contoh: <code>/delfsub 1</code> · <code>/delfsub all</code>", "Lihat slot: <code>/listfsub</code>"));
    }

    let removed;
    if (arg === "all") {
      removed = activeChannels(cfg);
      if (!removed.length) return card(ctx, E.info, "Tidak ada channel", "Grup ini belum punya channel wajib subscribe.");
    } else {
      const slot = Number(arg);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) return card(ctx, E.no, "Slot tidak valid", `Pilih <b>1–${MAX_SLOTS}</b> atau <code>all</code>.`);
      if (!cfg.channels[slot]) return card(ctx, E.no, `Slot ${slot} kosong`, "Cek isi slot dengan <code>/listfsub</code>.");
      removed = [[String(slot), cfg.channels[slot]]];
    }

    const c = await patchFsub(ctx.chat.id, (x) => {
      for (const [s] of removed) delete x.channels[s];
      if (!activeChannels(x).length) x.on = false; // tanpa channel fitur tidak punya arti
    });
    clearChatCache(ctx.chat.id);
    await richSay(
      ctx,
      note(E.ok, "Channel dihapus", removed.map(([s, ch]) => `Slot <b>${s}</b>: ${esc(ch.title || ch.id)}`).join("<br>")) +
        (!activeChannels(c).length && cfg.on ? quote(`${E.info} Tidak ada channel tersisa, Force Subscribe otomatis dimatikan.`) : "")
    );
  },
};

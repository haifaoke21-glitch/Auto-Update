import { esc, richSay, card, requireBotRight } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { MODES, MAX_SLOTS, getFsub, patchFsub, activeChannels, panelView, clearChatCache } from "../../src/lib/fsub.js";

const usage = () =>
  quote(
    `${E.note} <b>Cara pakai Force Subscribe</b>`,
    `<code>/setfsub 1 @channel</code> — pasang channel wajib (slot 1–${MAX_SLOTS})`,
    "<code>/delfsub 1</code> · <code>/delfsub all</code> — hapus channel",
    "<code>/listfsub</code> — lihat channel wajib grup ini",
    "<code>/fsub on</code> · <code>/fsub off</code> — nyalakan / matikan",
    "<code>/fsub mode once|strict|soft</code> — pilih mode",
    "<code>/fsub reset</code> — kosongkan daftar member terverifikasi",
    "<code>/reload</code> · <code>/checkfsub</code> — refresh cache & diagnostik"
  );

export default {
  command: ["fsub", "forcesub"],
  category: "group",
  description: "Force Subscribe per grup: wajib join channel sebelum chat. Contoh: /fsub on | off | mode strict | status",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const chatId = ctx.chat.id;
    const cfg = getFsub(chatId);
    let sub = (args[0] || "").toLowerCase();
    if (MODES[sub]) { args = ["mode", sub]; sub = "mode"; } // /fsub strict = /fsub mode strict

    if (!sub || sub === "status") {
      const v = panelView(chatId);
      return richSay(ctx, v.rich + usage(), v.rows);
    }

    if (sub === "on" || sub === "off") {
      if (sub === "on") {
        if (!activeChannels(cfg).length) {
          return card(ctx, E.no, "Belum ada channel", "Pasang dulu dengan <code>/setfsub 1 @channel</code>, baru nyalakan.");
        }
        const c = await patchFsub(chatId, (x) => { x.on = true; });
        await richSay(ctx, note(E.ok, "Force Subscribe diaktifkan", `Mode <b>${MODES[c.mode].label}</b> · ${activeChannels(c).length} channel wajib.<br>${esc(MODES[c.mode].desc)}`));
        if (await requireBotRight(ctx, "can_delete_messages", "Hapus pesan")) {
          if (c.mode === "strict") await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
        }
        return;
      }
      await patchFsub(chatId, (x) => { x.on = false; });
      return richSay(ctx, note(E.ok, "Force Subscribe dimatikan", "Member bebas chat tanpa join channel."));
    }

    if (sub === "mode") {
      const mode = (args[1] || "").toLowerCase();
      if (!MODES[mode]) {
        return richSay(ctx, note(E.info, "Pilih mode", Object.entries(MODES).map(([k, m]) => `<code>${k}</code> — ${esc(m.desc)}`).join("<br>")) + quote("Contoh: <code>/fsub mode strict</code>"));
      }
      const c = await patchFsub(chatId, (x) => { x.mode = mode; });
      await richSay(ctx, note(E.ok, `Mode diganti ke ${MODES[mode].label}`, esc(MODES[mode].desc)));
      if (c.on && mode === "strict") await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
      return;
    }

    if (sub === "reset") {
      await patchFsub(chatId, (x) => { x.verified = {}; });
      clearChatCache(chatId);
      return card(ctx, E.reset, "Daftar verifikasi dikosongkan", "Semua member akan dicek ulang saat chat berikutnya.");
    }

    return richSay(ctx, usage());
  },
};

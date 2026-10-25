import { esc, richSay, requireBotRight } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { MODES, getFsub, patchFsub } from "../../src/lib/fsub.js";

export default {
  command: ["setmode"],
  category: "group",
  description: "Ganti mode Force Subscribe: once, strict, atau soft. Contoh: /setmode strict",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const mode = String(args[0] || "").toLowerCase();
    if (!MODES[mode]) {
      const cur = getFsub(ctx.chat.id).mode;
      return richSay(
        ctx,
        note(E.info, "Pilih mode Force Subscribe", `Mode sekarang: <b>${MODES[cur].label}</b><br>` + Object.entries(MODES).map(([k, m]) => `<code>${k}</code> — ${esc(m.desc)}`).join("<br>")) +
          quote("Contoh: <code>/setmode strict</code>")
      );
    }
    const c = await patchFsub(ctx.chat.id, (x) => { x.mode = mode; });
    await richSay(ctx, note(E.ok, `Mode diganti ke ${MODES[mode].label}`, esc(MODES[mode].desc)));
    if (c.on && mode === "strict") await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
  },
};

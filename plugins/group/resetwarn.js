import { getGroup, saveGroup } from "../../src/database.js";
import { resolveTarget, mention, fullName } from "../../src/lib/groupUtil.js";
import { replyView, title, table, h } from "../../src/lib/richUi.js";
import { maxWarn, bar, who } from "../../src/lib/warnUi.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["unwarn"],
  category: "group",
  description: "Reset warn member ke 0 (/unwarn mengurangi 1). Contoh: /unwarn @user",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    const t = await resolveTarget(ctx, args, { usage: "/unwarn @username", allowOutside: true });
    if (!t) return;
    const group = getGroup(ctx.chat.id);
    group.warns ||= {};
    const id = String(t.id);
    const used = ctx.message.text.trim().split(/\s+/)[0].replace(/^\W+/, "").split("@")[0].toLowerCase();
    const before = group.warns[id] || 0;
    group.warns[id] = used === "unwarn" ? Math.max(before - 1, 0) : 0;
    await saveGroup(ctx.chat.id, { warns: group.warns });

    const limit = maxWarn(group);
    const now = group.warns[id];
    const dec = used === "unwarn";
    await replyView(
      ctx,
      title(E.ok, dec ? "Warn Dikurangi" : "Warn Direset") +
        table(["Detail", "Info"], [
          [`${E.user} Member`, who(t.id, t.name)],
          [`${E.warn} Sebelumnya`, `<b>${before}/${limit}</b> ${bar(before, limit)}`],
          [`${E.ok} Sekarang`, `<b>${now}/${limit}</b> ${bar(now, limit)}`],
          [`${E.shield} Oleh`, mention(ctx.from.id, fullName(ctx.from))],
        ])
    );
  },
};

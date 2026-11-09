import { richSay, resolveTarget } from "../../src/lib/groupUtil.js";
import { diagnoseHtml } from "../../src/lib/fsub.js";

export default {
  command: ["checkfsub", "cekfsub"],
  category: "group",
  description: "Diagnostik Force Subscribe real-time (izin bot, akses channel, cache). Balas pesan member untuk cek status join-nya",
  adminOnly: true,
  groupOnly: true,
  cooldown: 5000,
  run: async (ctx, { args }) => {
    let target = null;
    if (ctx.message.reply_to_message?.from || args[0]) {
      const t = await resolveTarget(ctx, args, { usage: "/checkfsub @username", allowOutside: true });
      if (!t) return;
      target = { id: t.id, name: t.name };
    }
    await richSay(ctx, await diagnoseHtml(ctx, target));
  },
};

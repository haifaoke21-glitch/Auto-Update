import { resolveTarget, guardTarget, requireBotRight, say, mention, reasonLine, friendlyError } from "../../src/lib/groupUtil.js";

export default {
  command: ["ban"],
  category: "group",
  description: "Ban permanen member dari grup. Balas pesan atau sebut @username/ID. Contoh: /ban @user promosi",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/ban @username alasan", allowOutside: true });
    if (!t || !(await guardTarget(ctx, t, "ban"))) return;
    try {
      await ctx.telegram.banChatMember(ctx.chat.id, t.id, { revoke_messages: false });
      await say(ctx, `<tg-emoji emoji-id="5240241223632954241">🚫</tg-emoji> ${mention(t.id, t.name)} diban permanen dari grup.${reasonLine(t.rest)}\n<i>Buka ban: /unbans ${t.id}</i>`);
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "ban")}`);
    }
  },
};

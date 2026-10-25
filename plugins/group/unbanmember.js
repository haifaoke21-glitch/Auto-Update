import { resolveTarget, requireBotRight, say, mention, friendlyError } from "../../src/lib/groupUtil.js";

export default {
  command: ["unbans"],
  category: "group",
  description: "Buka ban member di grup (supaya bisa join lagi). Contoh: /unbans 123456789",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/unbans 123456789", allowOutside: true });
    if (!t) return;
    try {
      await ctx.telegram.unbanChatMember(ctx.chat.id, t.id, { only_if_banned: true });
      await say(ctx, `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Ban ${mention(t.id, t.name)} dibuka. Dia bisa bergabung lagi.`);
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "unban")}`);
    }
  },
};

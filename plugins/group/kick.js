import { resolveTarget, guardTarget, requireBotRight, say, mention, reasonLine, friendlyError } from "../../src/lib/groupUtil.js";

export default {
  command: ["kick"],
  category: "group",
  description: "Keluarkan member dari grup (masih bisa join lagi). Balas pesan atau sebut @username/ID. Contoh: /kick @user spam",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/kick @username alasan" });
    if (!t || !(await guardTarget(ctx, t, "kick"))) return;
    try {
      await ctx.telegram.banChatMember(ctx.chat.id, t.id);
      await ctx.telegram.unbanChatMember(ctx.chat.id, t.id, { only_if_banned: true }); // supaya bisa join lagi
      await say(ctx, `<tg-emoji emoji-id="5240241223632954241">👢</tg-emoji> ${mention(t.id, t.name)} dikeluarkan dari grup.${reasonLine(t.rest)}`);
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "kick")}`);
    }
  },
};

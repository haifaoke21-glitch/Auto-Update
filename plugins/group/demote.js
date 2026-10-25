import { dropAdmins } from "../../src/lib/adminCache.js";
import { resolveTarget, guardTarget, requireBotRight, say, mention, friendlyError } from "../../src/lib/groupUtil.js";

const NO_RIGHTS = {
  can_manage_chat: false, can_change_info: false, can_delete_messages: false, can_invite_users: false,
  can_restrict_members: false, can_pin_messages: false, can_promote_members: false, can_manage_video_chats: false,
  can_post_stories: false, can_edit_stories: false, can_delete_stories: false, is_anonymous: false,
};

export default {
  command: ["demote"],
  category: "group",
  description: "Turunkan admin jadi member biasa. Contoh: /demote @user",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_promote_members", "Tambah admin baru"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/demote @username" });
    if (!t || !(await guardTarget(ctx, t, "demote", { allowAdmin: true }))) return;
    if (t.status === "creator") return say(ctx, "<tg-emoji emoji-id=\"5240241223632954241\">🚫</tg-emoji> Tidak bisa demote pemilik grup.");
    if (t.status !== "administrator") return say(ctx, `<tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> ${mention(t.id, t.name)} bukan admin.`);
    try {
      await ctx.telegram.promoteChatMember(ctx.chat.id, t.id, NO_RIGHTS);
      dropAdmins(ctx.chat.id);
      await say(ctx, `⬇️ ${mention(t.id, t.name)} sekarang menjadi member biasa.`);
    } catch (err) {
      const msg = friendlyError(err, "demote");
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${msg}${/izin/.test(msg) ? "" : "\n<i>Bot hanya bisa demote admin yang dipromosikan oleh bot itu sendiri.</i>"}`);
    }
  },
};

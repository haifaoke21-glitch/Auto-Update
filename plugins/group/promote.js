import { dropAdmins } from "../../src/lib/adminCache.js";
import { resolveTarget, guardTarget, requireBotRight, say, mention, friendlyError } from "../../src/lib/groupUtil.js";

export default {
  command: ["promote"],
  category: "group",
  description: "Jadikan member sebagai admin (hapus pesan, blokir, undang, pin). Contoh: /promote @user",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_promote_members", "Tambah admin baru"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/promote @username" });
    if (!t) return;
    if (["administrator", "creator"].includes(t.status)) return say(ctx, `<tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> ${mention(t.id, t.name)} sudah menjadi admin.`);
    if (!(await guardTarget(ctx, t, "promote", { allowAdmin: true }))) return;
    try {
      await ctx.telegram.promoteChatMember(ctx.chat.id, t.id, {
        can_manage_chat: true,
        can_delete_messages: true,
        can_restrict_members: true,
        can_invite_users: true,
        can_pin_messages: true,
        can_manage_video_chats: true,
      });
      dropAdmins(ctx.chat.id);
      await say(ctx, `<tg-emoji emoji-id="6269089154647200653">⬆️</tg-emoji> ${mention(t.id, t.name)} sekarang menjadi <b>admin</b>.`);
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "promote")}`);
    }
  },
};

import { resolveTarget, requireBotRight, say, mention, friendlyError } from "../../src/lib/groupUtil.js";

export default {
  command: ["unmute"],
  category: "group",
  description: "Buka mute member sesuai izin default grup. Contoh: /unmute @user",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/unmute @username" });
    if (!t) return;
    try {
      // pakai izin default grup supaya hasil unmute sama dengan member lain
      const chat = await ctx.telegram.getChat(ctx.chat.id);
      const perms = chat.permissions || {
        can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
        can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
        can_send_other_messages: true, can_add_web_page_previews: true,
      };
      await ctx.telegram.restrictChatMember(ctx.chat.id, t.id, { permissions: { ...perms, can_send_messages: true } });
      await say(ctx, `<tg-emoji emoji-id="5213391561999526028">🔊</tg-emoji> ${mention(t.id, t.name)} sudah bisa mengirim pesan lagi.`);
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "unmute")}`);
    }
  },
};

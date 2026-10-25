import { resolveTarget, guardTarget, requireBotRight, parseDuration, fmtDuration, richSay, card, mention, reasonQuote, friendlyError, MUTE_PERMS } from "../../src/lib/groupUtil.js";
import { quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["mute"],
  category: "group",
  description: "Bisukan member (permanen atau berdurasi: 30s, 10m, 2h, 1d, 1w). Contoh: /mute @user 1h spam",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/mute @username 1h alasan" });
    if (!t || !(await guardTarget(ctx, t, "mute"))) return;

    let sec = parseDuration(t.rest[0]);
    const reason = sec !== null ? t.rest.slice(1) : t.rest;
    if (sec !== null && sec < 30) sec = 30;
    const forever = sec === null || sec > 366 * 86400; // Telegram: <30 dtk atau >366 hari = permanen
    try {
      await ctx.telegram.restrictChatMember(ctx.chat.id, t.id, {
        permissions: MUTE_PERMS,
        ...(forever ? {} : { until_date: Math.floor(Date.now() / 1000) + sec }),
      });
      await richSay(ctx, quote(`${E.mute} ${mention(t.id, t.name)} dimute ${forever ? "<b>permanen</b>" : `selama <b>${fmtDuration(sec)}</b>`}.`) + reasonQuote(reason));
    } catch (err) {
      await card(ctx, E.no, "Gagal mute", friendlyError(err, "mute"));
    }
  },
};

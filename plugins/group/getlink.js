import { requireBotRight, parseDuration, fmtDuration, say, esc, friendlyError } from "../../src/lib/groupUtil.js";
import { purgeExpired, saveLinks, MAX_PENDING } from "../../src/lib/getlink.js";

const DEFAULT_SEC = 86400; // 1 hari
const MAX_SEC = 30 * 86400;

export default {
  command: ["getlink"],
  category: "group",
  description: "Buat link undangan sekali pakai khusus satu orang; orang lain tidak bisa masuk lewat link itu. Contoh: /getlink @username 1d",
  groupOnly: true,
  cooldown: 20000,
  run: async (ctx, { args }) => {
    const target = args[0];
    const isUser = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target || "");
    const isId = /^\d{5,}$/.test(target || "");
    if (!isUser && !isId) {
      return say(ctx, "<tg-emoji emoji-id=\"5231012545799666522\">ℹ️</tg-emoji> Format: <code>/getlink @username</code> (opsional durasi: <code>/getlink @username 2h</code>)\nLink hanya bisa dipakai <b>1 orang</b> yang kamu sebut. Pengguna lain yang mencoba masuk akan ditolak otomatis.");
    }
    if (!(await requireBotRight(ctx, "can_invite_users", "Undang pengguna via link"))) return;

    let sec = parseDuration(args[1]) ?? DEFAULT_SEC;
    sec = Math.min(Math.max(sec, 60), MAX_SEC);

    const links = purgeExpired(ctx.chat.id);
    if (Object.keys(links).length >= MAX_PENDING) {
      return say(ctx, `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sudah ada ${MAX_PENDING} link aktif di grup ini. Tunggu sampai dipakai atau kedaluwarsa.`);
    }

    try {
      const exp = Math.floor(Date.now() / 1000) + sec;
      const who = isId ? target : target.replace(/^@/, "");
      const inv = await ctx.telegram.createChatInviteLink(ctx.chat.id, {
        name: `getlink ${isId ? "" : "@"}${who}`.slice(0, 32),
        expire_date: exp,
        creates_join_request: true, // bot yang menyetujui, hanya untuk orang yang dituju
      });
      links[inv.invite_link] = {
        username: isId ? null : who.toLowerCase(),
        userId: isId ? Number(target) : null,
        by: ctx.from.id,
        exp,
      };
      await saveLinks();
      await say(
        ctx,
        `<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Link undangan pribadi</b> untuk ${isId ? `<code>${esc(target)}</code>` : `@${esc(who)}`}\n${esc(inv.invite_link)}\n\n<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Berlaku <b>${fmtDuration(sec)}</b> • 1 orang saja\n<i>Hanya ${isId ? "ID itu" : `@${esc(who)}`} yang akan disetujui. Pengguna lain ditolak otomatis.</i>`
      );
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "membuat link")}`);
    }
  },
};

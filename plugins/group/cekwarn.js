import { getGroup } from "../../src/database.js";
import { resolveTarget, mention, fullName } from "../../src/lib/groupUtil.js";
import { isOwner, isGroupAdmin } from "../../src/middleware.js";
import { replyView, title, table, quote, note, h } from "../../src/lib/richUi.js";
import { maxWarn, bar, sendWarnCard } from "../../src/lib/warnUi.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["cekwarn"],
  category: "group",
  description: "Lihat warn member (admin dapat tombol Mute Permanen & Reset Warn), atau daftar semua yang punya warn. Contoh: /cekwarn @user",
  groupOnly: true,
  run: async (ctx, { args }) => {
    const group = getGroup(ctx.chat.id);
    const limit = maxWarn(group);
    const warns = group.warns || {};

    // tanpa target & bukan reply: daftar semua warn aktif
    if (!args.length && !ctx.message.reply_to_message) {
      const rows = Object.entries(warns).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 25);
      if (!rows.length) return replyView(ctx, note(E.ok, "Belum ada warn", "Belum ada member yang punya warn di grup ini."));
      const lines = await Promise.all(rows.map(async ([id, n], i) => {
        let name = id;
        try { name = fullName((await ctx.telegram.getChatMember(ctx.chat.id, id)).user); } catch {}
        return [String(i + 1), mention(id, name), `<b>${n}/${limit}</b> ${bar(n, limit)}`];
      }));
      return replyView(
        ctx,
        title(E.list, "Daftar Warn") +
          table(["No", "Member", "Warn"], lines) +
          quote(`Batas warn: <b>${limit}</b> — mencapai batas = otomatis dikick.`, "Detail & tombol: <code>/cekwarn @user</code>")
      );
    }

    const t = await resolveTarget(ctx, args, { usage: "/cekwarn @username", allowOutside: true });
    if (!t) return;
    // tombol Mute / Reset hanya ditampilkan untuk admin (dicek lagi saat ditekan)
    const admin = isOwner(ctx.from.id) || (await isGroupAdmin(ctx));
    await sendWarnCard(ctx, { id: t.id, name: t.name, kind: "cek", noButtons: !admin });
  },
};

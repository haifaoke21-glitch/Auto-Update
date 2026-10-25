import { getGroup, saveGroup } from "../../src/database.js";
import { resolveTarget, guardTarget, requireBotRight, fullName, friendlyError, mention } from "../../src/lib/groupUtil.js";
import { replyView, title, table, quote, note, h } from "../../src/lib/richUi.js";
import { maxWarn, DEFAULT_MAX_WARN, bar, sendWarnCard, who } from "../../src/lib/warnUi.js";
import { E } from "../../src/lib/emo.js";

// groupinfo.js & cekwarn.js masih mengimpor dari sini
export { maxWarn, DEFAULT_MAX_WARN };

export default {
  command: ["warn"],
  category: "group",
  description: "Beri peringatan ke member (kartu Rich Message + tombol Mute Permanen & Reset Warn); mencapai batas = auto-kick (default 3, ubah: /warn limit 5). Contoh: /warn @user spam",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    const group = getGroup(ctx.chat.id);

    // /warn limit <1-20>
    if (args[0]?.toLowerCase() === "limit") {
      const n = parseInt(args[1]);
      if (!n || n < 1 || n > 20) {
        return replyView(ctx, note(E.gear, "Batas warn", `Saat ini: <b>${maxWarn(group)}</b><br>Ubah: <code>/warn limit 5</code> (1–20)`));
      }
      await saveGroup(ctx.chat.id, { warnLimit: n });
      return replyView(ctx, note(E.ok, "Batas warn diubah", `Sekarang <b>${n}</b> warn. Mencapai batas = otomatis dikick.`));
    }

    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const t = await resolveTarget(ctx, args, { usage: "/warn @username alasan" });
    if (!t || !(await guardTarget(ctx, t, "warn"))) return;

    const limit = maxWarn(group);
    const id = String(t.id);
    const reason = t.rest.join(" ").trim();
    const by = { id: ctx.from.id, name: fullName(ctx.from) };
    group.warns ||= {};
    group.warns[id] = (group.warns[id] || 0) + 1;
    await saveGroup(ctx.chat.id, { warns: group.warns });
    const count = group.warns[id];

    if (count >= limit) {
      try {
        await ctx.telegram.banChatMember(ctx.chat.id, t.id);
        await ctx.telegram.unbanChatMember(ctx.chat.id, t.id, { only_if_banned: true });
        group.warns[id] = 0;
        await saveGroup(ctx.chat.id, { warns: group.warns });
        return replyView(
          ctx,
          title(E.deny, "Auto Kick") +
            table(["Detail", "Info"], [
              [`${E.user} Member`, who(t.id, t.name)],
              [`${E.warn} Warn`, `<b>${limit}/${limit}</b> ${bar(limit, limit)}`],
              [`${E.kick} Aksi`, "Dikeluarkan dari grup (bisa bergabung lagi)"],
              [`${E.shield} Oleh`, mention(by.id, by.name)],
            ]) +
            (reason ? quote(`${E.note} <b>Alasan</b>`, h(reason)) : "")
        );
      } catch (err) {
        // gagal kick: kartu biasa + catatan, tombol Mute / Reset tetap bisa dipakai
        return sendWarnCard(ctx, { id: t.id, name: t.name, reason, by, note: `${E.warn} <b>Sudah ${count}/${limit} warn</b>, tapi ${h(friendlyError(err, "kick").toLowerCase())}` });
      }
    }
    await sendWarnCard(ctx, { id: t.id, name: t.name, reason, by });
  },
};

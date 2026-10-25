import { unlockGroup, getLock } from "../../src/lib/groupLock.js";
import { requireBotRight, richSay, card, esc, friendlyError } from "../../src/lib/groupUtil.js";
import { quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["unlockall", "bukagrup"],
  category: "group",
  description: "Buka grup yang ditutup (/lockall): member bisa kirim pesan lagi. Contoh: /unlockall",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx) => {
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    const wasLocked = Boolean(getLock(ctx.chat.id));
    try {
      await unlockGroup(ctx.telegram, ctx.chat.id);
      await richSay(
        ctx,
        quote(`🔓 <b>Grup dibuka</b>`, wasLocked ? "Izin grup dikembalikan seperti sebelum ditutup. Semua member bisa mengirim pesan lagi." : "Semua member bisa mengirim pesan.")
      );
    } catch (err) {
      await card(ctx, E.no, "Gagal membuka grup", esc(friendlyError(err, "membuka grup")));
    }
  },
};

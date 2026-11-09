import { lockGroup, MIN_LOCK_SEC, MAX_LOCK_SEC } from "../../src/lib/groupLock.js";
import { isCloneCtx } from "../../src/lib/jadibot.js";
import { requireBotRight, parseDuration, fmtDuration, richSay, card, esc, friendlyError } from "../../src/lib/groupUtil.js";
import { quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";

const usage = quote(
  "Tutup sampai dibuka manual: <code>/lockall</code>",
  "Tutup dengan timer: <code>/lockall 30m</code> (30s, 10m, 2h, 1d, 1w)",
  "Dengan alasan: <code>/lockall 1h istirahat</code>",
  "Buka lagi: <code>/unlockall</code>"
);

export default {
  command: ["lockall", "tutupgrup"],
  category: "group",
  description: "Tutup grup: member tidak bisa kirim pesan, bisa pakai timer (30s, 10m, 2h, 1d). Contoh: /lockall 1h | /lockall",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    let sec = null;
    let rest = args;
    if (args.length && /^\d/.test(args[0])) {
      sec = parseDuration(args[0]);
      if (sec === null) return card(ctx, E.no, "Durasi tidak valid", `Contoh: <code>/lockall 30m</code>, <code>/lockall 2h</code>, <code>/lockall 1d</code>`);
      if (sec < MIN_LOCK_SEC || sec > MAX_LOCK_SEC) {
        return card(ctx, E.no, "Durasi di luar batas", `Timer minimal <b>${fmtDuration(MIN_LOCK_SEC)}</b> dan maksimal <b>${fmtDuration(MAX_LOCK_SEC)}</b>.`);
      }
      rest = args.slice(1);
    }
    if (sec && isCloneCtx(ctx)) {
      return card(ctx, E.warn, "Timer tidak tersedia di bot clone", "Pembukaan otomatis hanya jalan di bot utama. Pakai <code>/lockall</code> tanpa timer lalu <code>/unlockall</code>.");
    }
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;

    const reason = rest.join(" ").trim().slice(0, 200);
    try {
      const { already, lock } = await lockGroup(ctx.telegram, ctx.chat.id, { sec, by: ctx.from?.id, reason });
      const when = lock.until ? `Dibuka otomatis dalam <b>${fmtDuration(sec)}</b>.` : "Tetap tertutup sampai dibuka dengan <code>/unlockall</code>.";
      await richSay(
        ctx,
        quote(`🔒 <b>${already ? "Timer grup diperbarui" : "Grup ditutup"}</b>`, `Hanya admin yang bisa mengirim pesan.<br>${when}`) +
          (reason ? quote(`${E.note} <b>Alasan</b>`, esc(reason)) : "") +
          quote(`Buka kapan saja: <code>/unlockall</code>`)
      );
    } catch (err) {
      await card(ctx, E.no, "Gagal menutup grup", esc(friendlyError(err, "menutup grup")));
    }
  },
};

import { showJadibotMenu, handleToken, stopClone, getClone, listClones, canJadibot, isCloneCtx, TOKEN_RE } from "../../src/lib/jadibot.js";
import { replyNote, replyView, title, table } from "../../src/lib/richUi.js";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default {
  command: ["jadibot", "stopjadibot", "listjadibot"],
  category: "main",
  description: "Jadi Bot (Premium ke atas): jalankan salinan bot ini dengan token BotFather-mu. Contoh: /jadibot | /stopjadibot | /listjadibot (owner)",
  loading: false,
  run: async (ctx, { args }) => {
    const cmd = (ctx.message?.text || "").trim().replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    if (isCloneCtx(ctx)) return replyNote(ctx, "⚠️", "Jadi Bot", "Fitur ini hanya bisa dipakai lewat bot utama.");

    if (cmd === "listjadibot") {
      const { isOwner } = await import("../../src/middleware.js");
      if (!isOwner(ctx.from.id)) return replyNote(ctx, "❌", "Akses ditolak", "Perintah ini khusus owner bot.");
      const list = listClones();
      if (!list.length) return replyNote(ctx, "🤖", "Jadi Bot", "Belum ada bot clone yang berjalan.");
      return replyView(
        ctx,
        title("🤖", `Bot Clone Aktif (${list.length})`) +
          table(["No", "Bot", "Pemilik"], list.map((c, i) => [String(i + 1), `@${esc(c.username)}`, `<code>${c.owner}</code>`]))
      );
    }

    if (ctx.chat.type !== "private") return replyNote(ctx, "🔒", "Jadi Bot", "Fitur Jadi Bot hanya bisa dipakai di chat pribadi bot.");
    if (!canJadibot(ctx.from.id)) return replyNote(ctx, "💎", "Jadi Bot", "Fitur Jadi Bot khusus pengguna Premium ke atas.");

    if (cmd === "stopjadibot") {
      const c = await stopClone(ctx.from.id);
      return replyNote(ctx, c ? "⏹️" : "ℹ️", c ? "Bot dihentikan" : "Jadi Bot", c ? `Bot <b>@${esc(c.username)}</b> dihentikan.` : "Kamu belum punya bot clone yang berjalan.");
    }

    // /jadibot <token> langsung; tanpa token -> tampilkan menu
    const token = args[0];
    if (token) {
      if (!TOKEN_RE.test(token)) return replyNote(ctx, "⚠️", "Format token tidak dikenali", "Contoh: <code>/jadibot 123456789:AAH...</code>");
      if (getClone(ctx.from.id)) return replyNote(ctx, "ℹ️", "Jadi Bot", "Kamu sudah punya bot clone yang berjalan. Hentikan dulu dengan /stopjadibot.");
      return handleToken(ctx, token);
    }
    return showJadibotMenu(ctx);
  },
};

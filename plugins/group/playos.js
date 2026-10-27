import { say, esc } from "../../src/lib/groupUtil.js";
import { createGroupCallMT, mtprotoConfigured } from "../../src/lib/mtproto.js";
import { isCloneCtx } from "../../src/lib/cloneGuard.js";

export default {
  command: ["playos", "vcall", "startcall"],
  category: "group",
  description: "Mulai panggilan suara (Voice Chat) di grup menggunakan MTProto. Bot harus admin dengan hak kelola video chat. Contoh: /playos Meeting",
  adminOnly: true,
  groupOnly: true,
  cooldown: 15000,
  run: async (ctx, { text }) => {
    if (isCloneCtx(ctx)) return say(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Fitur PlayOS hanya tersedia di bot utama.");
    if (!mtprotoConfigured()) {
      return say(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> MTProto belum aktif.\nIsi <code>mtproto.apiId</code> & <code>apiHash</code> di config.js (dari my.telegram.org) lalu restart bot.");
    }

    const title = (text || "").trim() || "Voice Chat";
    try {
      await say(ctx, `<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Memulai panggilan suara: <b>${esc(title)}</b>…`);
      const res = await createGroupCallMT(ctx.chat.id, title);
      await say(ctx, `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Panggilan suara <b>${esc(title)}</b> berhasil dimulai!\nSilakan bergabung lewat tombol Voice Chat di grup.`);
    } catch (e) {
      const msg = esc(e?.errorMessage || e?.message || String(e));
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal memulai panggilan suara.\n<code>${msg}</code>\n\nPastikan:\n• Bot <b>admin</b>\n• Bot punya hak <b>Kelola video chat</b>\n• MTProto (apiId/apiHash) sudah benar`);
    }
  },
};

import { requireBotRight, richSay, card, friendlyError } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["pinchat"], // jangan pakai alias "pin": sudah dipakai downloader Pinterest
  category: "group",
  description: "Sematkan (pin) pesan di grup. Balas pesan lalu ketik /pinchat. Tambah 'silent' supaya tanpa notifikasi. Contoh: /pinchat | /pinchat silent",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    const target = ctx.message?.reply_to_message;
    if (!target) {
      return richSay(ctx, note(E.info, "Pesan belum dipilih", "Balas pesan yang ingin disematkan dengan <code>/pinchat</code>.") + quote("Tanpa notifikasi: <code>/pinchat silent</code>", "Lepas pin: <code>/unpinchat</code>"));
    }
    if (!(await requireBotRight(ctx, "can_pin_messages", "Sematkan pesan"))) return;

    const silent = ["silent", "senyap", "diam", "quiet"].includes(args[0]?.toLowerCase());
    try {
      await ctx.telegram.pinChatMessage(ctx.chat.id, target.message_id, { disable_notification: silent });
      await card(ctx, E.ok, "Pesan disematkan", silent ? "<i>Tanpa notifikasi.</i>" : "");
    } catch (err) {
      await card(ctx, E.no, "Gagal menyematkan", friendlyError(err, "menyematkan pesan"));
    }
  },
};

import { richSay, card } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { MAX_SLOTS, applyChannel } from "../../src/lib/fsub.js";

export default {
  command: ["setfsub"],
  category: "group",
  description: "Pasang channel/grup wajib subscribe (slot otomatis, bisa lanjut kirim username/link tanpa command). Contoh: /setfsub @channel | /setfsub https://t.me/channel | /setfsub -1001234567890 | /setfsub https://t.me/+abc",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    let slot = null;
    let rest = args;
    if (/^\d{1,2}$/.test(args[0] || "")) {
      slot = Number(args[0]);
      rest = args.slice(1);
    }
    if (slot !== null && (slot < 1 || slot > MAX_SLOTS)) {
      return card(ctx, E.no, "Slot tidak valid", `Slot hanya <b>1–${MAX_SLOTS}</b>. Contoh: <code>/setfsub 1 @channel</code>`);
    }
    if (!rest[0]) {
      return richSay(
        ctx,
        note(E.info, "Pasang channel wajib", "Bot harus jadi <b>admin</b> di channel itu.") +
          quote(
            "<code>/setfsub @namachannel</code>",
            "<code>/setfsub 2 https://t.me/namachannel</code>",
            "<code>/setfsub -1001234567890</code> atau <code>/setfsub https://t.me/+linkundangan</code> — channel / supergroup privat (cukup salah satu; bot harus admin di sana)",
            "Tanpa nomor slot, channel masuk ke slot kosong pertama.",
            "Setelah berhasil, langsung kirim username / link / ID berikutnya (tanpa /setfsub), lalu tekan tombol Selesai."
          )
      );
    }
    await applyChannel(ctx, slot, rest);
  },
};

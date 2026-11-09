import { startTextMatch } from "../../src/lib/textmatch.js";

// /textmatch -> bot minta teks -> muncul tombol Ratio & Sound (Rich Message) -> Buat.
// Logika lengkap ada di src/lib/textmatch.js (API: https://api-cloud.my.id/maker/textmatch).
export default {
  command: ["textmatch"],
  category: "canvas",
  description: "Buat TextMatch dari teks, pilih ratio & sound lewat tombol. Contoh: /textmatch  atau  /textmatch halo dunia",
  cooldown: 3000,
  loading: false,
  run: async (ctx, { text }) => {
    const reply = ctx.message?.reply_to_message;
    const input = String(text || reply?.text || reply?.caption || "").trim();
    await startTextMatch(ctx, input);
  },
};

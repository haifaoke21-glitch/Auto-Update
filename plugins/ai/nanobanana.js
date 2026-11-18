import { runImageTool } from "../../src/lib/imageTool.js";
import { XRINA } from "../../src/lib/xapi.js";

export default {
  command: ["nanobanana", "nb"],
  category: "ai",
  loading: false,
  loadingAction: "upload_photo",
  description: "Edit gambar dengan AI Nano Banana. Balas/kirim foto dengan /nanobanana ubah bajunya jadi merah",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    const prompt = (text || "").trim().slice(0, 500);
    if (!prompt) return ctx.reply("Contoh: balas/kirim foto dengan\n/nanobanana ubah rambutnya jadi biru");
    const ok = await runImageTool(ctx, {
      base: XRINA,
      path: "/ai-image/nanobanana",
      extra: { prompt },
      tag: "nanobanana",
      caption: "✅ Selesai",
      waitText: "Sedang mengedit gambar, tunggu sebentar...",
    });
    if (!ok) await ctx.reply("Balas/kirim sebuah foto dulu, lalu tulis prompt.\nContoh: /nanobanana ubah rambutnya jadi biru");
  },
};

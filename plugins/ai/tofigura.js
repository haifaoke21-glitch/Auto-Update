import { runImageTool } from "../../src/lib/imageTool.js";
import { XRINA } from "../../src/lib/xapi.js";

export default {
  command: ["tofigura", "tofigure"],
  category: "ai",
  loading: false,
  loadingAction: "upload_photo",
  description: "Ubah foto jadi action figure. Balas/kirim foto dengan /tofigura",
  cooldown: 15000,
  run: async (ctx) => {
    const ok = await runImageTool(ctx, { base: XRINA, path: "/ai-image/tofigurav2", tag: "tofigura", caption: "✅ Selesai", waitText: "Sedang membuat action figure, tunggu sebentar..." });
    if (!ok) await ctx.reply("Contoh: balas/kirim sebuah foto dengan /tofigura");
  },
};

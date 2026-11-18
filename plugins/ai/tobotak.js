import { runImageTool } from "../../src/lib/imageTool.js";
import { XRINA } from "../../src/lib/xapi.js";

export default {
  command: ["tobotak", "botak"],
  category: "ai",
  loading: false,
  loadingAction: "upload_photo",
  description: "Ubah foto jadi botak (rambut dihilangkan). Balas/kirim foto dengan /tobotak",
  cooldown: 15000,
  run: async (ctx) => {
    const ok = await runImageTool(ctx, { base: XRINA, path: "/ai-image/tobotak", tag: "tobotak", caption: "✅ Selesai", waitText: "Sedang mengubah foto, tunggu sebentar..." });
    if (!ok) await ctx.reply("Contoh: balas/kirim sebuah foto dengan /tobotak");
  },
};

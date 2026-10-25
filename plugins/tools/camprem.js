import { startFlow } from "../../src/lib/satriam.js";

// Alur lewat tombol (lihat src/lib/satriam.js). Koin (kategori tools) baru dipotong saat Magic Link
// benar-benar dikirim, jadi `cost: 0` di sini supaya membuka/membatalkan alur tidak memotong koin.
export default {
  command: ["camprem"],
  category: "tools",
  description: "Login Satriam AMP via Magic Link (bot memandu lewat tombol, 10 koin)",
  privateOnly: true, // magic link bersifat sensitif -> hanya di chat pribadi
  cost: 0,
  loading: false,
  cooldown: 2000,
  run: async (ctx) => startFlow(ctx),
};

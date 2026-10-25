import { showDonate } from "../../src/lib/donate.js";

export default {
  command: ["donate"],
  category: "donasi",
  description: "Donasi ke bot: foto + nomor DANA, GoPay, OVO, SeaBank. Setelah transfer, kirim foto bukti tf",
  run: async (ctx) => showDonate(ctx),
};

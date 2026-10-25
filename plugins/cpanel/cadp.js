import { createAdminFlow } from "../../src/lib/cpanel/create.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { MAX_SLOT } from "../../src/lib/cpanel/roles.js";

export default {
  command: ["cadp"],
  hiddenCommands: Array.from({ length: MAX_SLOT - 1 }, (_, i) => `cadpv${i + 2}`),
  category: "cpanel",
  description: "Buat Admin Panel V1–V20 (Premium). Contoh: /cadp nama atau /cadp nama,idtelegram",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const m = cmdName(ctx).match(/^cadp(?:v(\d+))?$/);
    if (!m) return;
    return createAdminFlow(ctx, { slot: m[1] || "1", args });
  },
};

import { createPanelFlow } from "../../src/lib/cpanel/create.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { MAX_SLOT } from "../../src/lib/cpanel/roles.js";

const SIZES = Array.from({ length: 10 }, (_, i) => String(i + 1));
const visible = [...SIZES.map((n) => `${n}gb`), "unli"];
const hidden = [];
for (let v = 2; v <= MAX_SLOT; v++) {
  for (const n of SIZES) hidden.push(`${n}gbv${v}`);
  hidden.push(`unliv${v}`);
}

export default {
  command: visible,
  hiddenCommands: hidden,
  category: "cpanel",
  description: "Buat panel 1–10GB / Unli, V1–V20 (Reseller). Contoh: /2gb namapanel (versi lain: /2gbv3 nama, /unliv2 nama)",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const m = cmdName(ctx).match(/^(?:(\d+)gb|unli)(?:v(\d+))?$/);
    if (!m) return;
    const size = m[1] ? m[1] : "unli";
    const slot = m[2] || "1";
    return createPanelFlow(ctx, { slot, size, args });
  },
};

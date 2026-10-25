import { replyCpanelHub } from "../../src/lib/cpanel/hub.js";

export default {
  command: ["cpanel", "info"],
  category: "cpanel",
  description: "Menu CPanel interaktif: tombol Create Panel (1–10GB / Unli, V1–V20), Admin Panel & panduan. Contoh: /cpanel",
  run: async (ctx) => replyCpanelHub(ctx),
};

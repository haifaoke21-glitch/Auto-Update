import { isAutoReactOn, setAutoReact } from "../../src/lib/autoReact.js";

export default {
  command: ["autoreact"],
  category: "owner",
  description: "Aktif/nonaktifkan auto react (bot memberi reaksi emoji acak ke pesan masuk). Contoh: /autoreact on | off",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const mode = args[0]?.toLowerCase();
    if (mode === "on" || mode === "off") {
      await setAutoReact(mode === "on");
      return ctx.reply(`<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Auto react ${mode === "on" ? "DIAKTIFKAN" : "dinonaktifkan"}.` + (mode === "on" ? "\nDi grup, pastikan reaksi diizinkan dan bot punya akses kirim pesan." : ""), { parse_mode: "HTML" });
    }
    await ctx.reply(`<tg-emoji emoji-id="5341715473882955310">⚙️</tg-emoji> Auto react: ${isAutoReactOn() ? "AKTIF <tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji>" : "nonaktif <tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji>"}\nGunakan: /autoreact on atau /autoreact off`, { parse_mode: "HTML" });
  },
};

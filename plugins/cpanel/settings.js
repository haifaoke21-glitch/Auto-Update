import config from "../../config.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { h, replyNote, title, table, quote, replyView } from "../../src/lib/richUi.js";
import { getSetting, setSetting, isValidSlot, getPanel, setActiveSlot, slotName } from "../../src/lib/cpanel/ptero.js";

const TOGGLES = {
  panelres: { label: "Create Panel (Reseller)", on: "Pembuatan panel kini bisa dipakai.", off: "Semua pembuatan panel ditolak." },
  paneladp: { label: "Create Admin Panel", on: "Pembuatan admin panel kini bisa dipakai.", off: "Pembuatan admin panel ditolak." },
  adp: { label: "Mode ADP", on: "/cadp memakai panel slot ADP.", off: "/cadp memakai Panel V1." },
};

export default {
  command: ["panel", "paneladp", "adp"],
  category: "cpanel",
  description: "Panel aktif & on/off create panel/ADP (Owner Bot). Contoh: /panel 2, /panelres off",
  ownerOnly: true,
  run: async (ctx, { args }) => {
    const cmd = cmdName(ctx);
    const p = config.prefix;

    if (cmd === "panel") {
      const slot = String(args[0] || "").toLowerCase();
      if (!isValidSlot(slot) || slot === "adp") {
        return replyNote(ctx, "ℹ️", "Pilih panel aktif", `Contoh: <code>${p}panel 2</code> (1–20)<br>Memilih panel yang dipakai /delsrv, /suspend, /listsrv, dll.`);
      }
      if (!getPanel(slot)) return replyNote(ctx, "✕", `${h(slotName(slot))} belum dikonfigurasi`, `Atur dulu: <code>${p}setpanel ${slot} ...</code>`);
      await setActiveSlot(slot);
      return replyNote(ctx, "✅", "Panel aktif diganti", `Panel aktif sekarang: <b>${h(slotName(slot))}</b>`);
    }

    const t = TOGGLES[cmd];
    const v = String(args[0] || "").toLowerCase();
    if (!t || !["on", "off"].includes(v)) {
      return replyView(
        ctx,
        title("⚙️", h(t.label)) +
          table(["Info", "Status"], [["Saat ini", getSetting(cmd) ? "<tg-emoji emoji-id=\"6120946172010959542\">🟢</tg-emoji> <b>ON</b>" : "<tg-emoji emoji-id=\"5411225014148014586\">🔴</tg-emoji> <b>OFF</b>"]]) +
          quote(`Contoh: <code>${p}${cmd} on</code> / <code>${p}${cmd} off</code>`)
      );
    }
    await setSetting(cmd, v === "on");
    return replyNote(ctx, v === "on" ? "✅" : "⊘", `${h(t.label)} ${v === "on" ? "diaktifkan" : "dimatikan"}`, v === "on" ? t.on : t.off);
  },
};

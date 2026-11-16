import { registerCallback } from "../../src/lib/callbacks.js";
import { isOwner } from "../../src/middleware.js";
import { isCloneCtx } from "../../src/lib/cloneGuard.js";
import { replyView, editCbView } from "../../src/lib/richUi.js";
import { isConfigured, isAutoApply, setAutoApply, localVersion, V } from "../../src/lib/updater.js";

const btnRows = (on) => [[on
  ? { text: "🔴 Matikan", callback_data: "autoupd:off" }
  : { text: "🟢 Nyalakan", callback_data: "autoupd:on" }]];
const show = () => V.autoStatus(isAutoApply(), localVersion());

registerCallback("autoupd", async (ctx, [mode]) => {
  if (!isOwner(ctx.from?.id)) return ctx.answerCbQuery("Khusus owner bot.", { show_alert: true });
  if (mode !== "on" && mode !== "off") return ctx.answerCbQuery();
  setAutoApply(mode === "on");
  try { await editCbView(ctx, show().rich, btnRows(isAutoApply())); }
  catch (err) { if (!/not modified/i.test(err?.message || "")) throw err; }
  return ctx.answerCbQuery(mode === "on" ? "Auto update ON" : "Auto update OFF");
});

export default {
  command: ["autoupdate"],
  category: "owner",
  description: "Auto update otomatis tanpa /update: /autoupdate on | off (tanpa argumen = lihat status + tombol)",
  ownerOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    if (isCloneCtx(ctx)) return replyView(ctx, V.cloneLocked().rich, V.cloneLocked().rows);
    if (!isConfigured()) return replyView(ctx, V.notConfigured().rich, V.notConfigured().rows);
    const mode = (args[0] || "").toLowerCase();
    if (mode === "on" || mode === "off") setAutoApply(mode === "on");
    return replyView(ctx, show().rich, btnRows(isAutoApply()));
  },
};

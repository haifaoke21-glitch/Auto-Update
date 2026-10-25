// /autodelsrv on [interval] | off | (status)   —   /autodelsrv2 … /autodelsrv20 untuk panel V2–V20
// Menghapus otomatis server OFFLINE (+ user tanpa server) secara berkala, tanpa konfirmasi tiap putaran.
import config from "../../config.js";
import { cmdName, STAFF_DENY } from "../../src/lib/cpanel/util.js";
import { h, title, quote, table, replyView, replyNote } from "../../src/lib/richUi.js";
import { isStaff, MAX_SLOT } from "../../src/lib/cpanel/roles.js";
import { getActiveSlot, getPanel, slotName } from "../../src/lib/cpanel/ptero.js";
import { getAuto, enableAuto, disableAuto, parseInterval, fmtDuration, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS } from "../../src/lib/cpanel/autodel.js";

const hidden = [];
for (let v = 2; v <= MAX_SLOT; v++) hidden.push(`autodelsrv${v}`);

export default {
  command: ["autodelsrv"],
  hiddenCommands: hidden,
  category: "cpanel",
  description: "Auto hapus server offline & user tanpa server (Owner+). Contoh: /autodelsrv on 1h, /autodelsrv off, /autodelsrv2 on (panel V2)",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (!isStaff(ctx.from.id)) return replyView(ctx, STAFF_DENY);
    const m = cmdName(ctx).match(/^autodelsrv(\d+)?$/);
    if (!m) return;
    const slot = m[1] || getActiveSlot();
    const p = config.prefix;
    const sfx = m[1] || "";
    const name = h(slotName(slot));
    const sub = String(args[0] || "").toLowerCase();
    const cur = getAuto(slot);

    if (sub === "on") {
      const panel = getPanel(slot);
      if (!panel) return replyNote(ctx, "✕", `${name} belum dikonfigurasi`, `Atur lewat <code>${p}setpanel</code>.`);
      if (!panel.pltc) {
        return replyNote(ctx, "✕", `PLTC ${name} belum diisi`, `Client API key dibutuhkan untuk membaca status server.<br><code>${p}setpanel ${slot} &lt;domain&gt; &lt;plta&gt; &lt;pltc&gt;</code>`);
      }
      let intervalMs = DEFAULT_INTERVAL_MS;
      if (args[1]) {
        intervalMs = parseInterval(args[1]);
        if (!intervalMs) return replyNote(ctx, "✕", "Interval tidak valid", `Contoh: <code>${p}autodelsrv${sfx} on 30m</code>, <code>2h</code>, <code>1d</code>`);
        if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) return replyNote(ctx, "✕", "Interval di luar batas", "Interval harus antara 5 menit s/d 7 hari.");
      }
      await enableAuto(slot, { chatId: ctx.chat.id, intervalMs });
      return replyView(
        ctx,
        title("✅", "Auto Delete Server Aktif") +
          table(["Info", "Detail"], [
            ["Panel", name],
            ["⏱ Setiap", `<b>${fmtDuration(intervalMs)}</b>`],
            ["🗑 Dihapus", "Server <b>OFFLINE</b> + user non-admin tanpa server"],
            ["📨 Laporan", "Dikirim ke chat ini"],
          ]) +
          quote(`Proses pertama dalam ${fmtDuration(intervalMs)}.`, `Matikan: <code>${p}autodelsrv${sfx} off</code>`)
      );
    }

    if (sub === "off") {
      if (!cur?.enabled) return replyNote(ctx, "⚠️", "Sudah mati", `Auto Delete Server ${name} memang sedang mati.`);
      await disableAuto(slot);
      return replyNote(ctx, "⊘", "Auto Delete Server dimatikan", name);
    }

    // status
    return replyView(
      ctx,
      title("🗑", "Auto Delete Server") +
        table(["Info", "Status"], [
          ["Panel", name],
          ["Status", cur?.enabled ? `<tg-emoji emoji-id="6120946172010959542">🟢</tg-emoji> <b>ON</b> • setiap ${fmtDuration(cur.intervalMs)}` : "<tg-emoji emoji-id=\"5411225014148014586\">🔴</tg-emoji> <b>OFF</b>"],
          ...(cur?.enabled ? [["⏳ Berikutnya", `${fmtDuration(cur.nextRunAt - Date.now())} lagi`]] : []),
          ...(cur?.lastRunAt ? [["🕒 Terakhir", `${new Date(cur.lastRunAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} (${h(cur.lastResult || "-")})`]] : []),
        ]) +
        quote(`Pakai: <code>${p}autodelsrv${sfx} on [30m|2h|1d]</code> / <code>${p}autodelsrv${sfx} off</code>`)
    );
  },
};

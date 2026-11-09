import { getGroup, saveGroup } from "../../src/database.js";
import { richSay, card, requireBotRight, esc, parseDuration, fmtDuration } from "../../src/lib/groupUtil.js";
import { note, quote, table, title } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";
import { floodCfg, FLOOD_ACTIONS } from "../../src/lib/antiFlood.js";

const status = (c) =>
  title(E.shield, "Anti Flood") +
  table(["Pengaturan", "Nilai"], [
    [`${E.gear} Status`, c.on ? `<b>AKTIF</b> ${E.ok}` : `<b>nonaktif</b> ${E.no}`],
    [`${E.chart} Batas`, `<b>${c.limit}</b> pesan dalam <b>${c.window}</b> detik`],
    [`${E.deny} Tindakan`, `<b>${FLOOD_ACTIONS[c.action]}</b>${c.action === "mute" ? ` · ${fmtDuration(c.muteSec)}` : ""}`],
  ]) +
  quote(
    `${E.note} <b>Cara pakai</b>`,
    "<code>/antiflood on</code> · <code>/antiflood off</code>",
    "<code>/antiflood set 5 5</code> — batas pesan &amp; detik",
    "<code>/antiflood action delete|mute|kick|ban</code>",
    "<code>/antiflood action mute 30m</code> — durasi mute (30s, 10m, 2h, 1d)"
  ) +
  quote(`${E.info} Admin grup &amp; owner bot dikecualikan. Bot perlu admin dengan izin <b>Hapus pesan</b> dan <b>Blokir pengguna</b>.`);

export default {
  command: ["antiflood"],
  category: "group",
  description: "Batasi member yang spam pesan terlalu cepat (hapus/mute/kick/ban otomatis). Contoh: /antiflood on | set 5 5 | action mute 10m",
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const cur = floodCfg(getGroup(ctx.chat.id).antiflood);
    const sub = (args[0] || "").toLowerCase();
    const save = (patch) => saveGroup(ctx.chat.id, { antiflood: { ...cur, ...patch } });

    if (!sub || sub === "status") return richSay(ctx, status(cur));

    if (sub === "on" || sub === "off") {
      const on = sub === "on";
      const c = await save({ on });
      await richSay(ctx, note(E.ok, `Anti Flood ${on ? "diaktifkan" : "dinonaktifkan"}`, on ? `Batas <b>${c.antiflood.limit}</b> pesan / <b>${c.antiflood.window}</b> detik · ${FLOOD_ACTIONS[c.antiflood.action]}` : ""));
      if (on) {
        await requireBotRight(ctx, "can_delete_messages", "Hapus pesan");
        if (cur.action !== "delete") await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
      }
      return;
    }

    if (sub === "set") {
      const limit = Number(args[1]);
      const window = Number(args[2]);
      if (!Number.isInteger(limit) || limit < 3 || limit > 30 || !Number.isInteger(window) || window < 2 || window > 60) {
        return card(ctx, E.no, "Angka tidak valid", "Pakai: <code>/antiflood set &lt;pesan 3-30&gt; &lt;detik 2-60&gt;</code> — contoh <code>/antiflood set 5 5</code>.");
      }
      await save({ limit, window });
      return richSay(ctx, note(E.ok, "Batas diperbarui", `<b>${limit}</b> pesan dalam <b>${window}</b> detik.`));
    }

    if (sub === "action") {
      const act = (args[1] || "").toLowerCase();
      if (!FLOOD_ACTIONS[act]) return card(ctx, E.no, "Tindakan tidak dikenal", "Pilih: <code>delete</code>, <code>mute</code>, <code>kick</code>, atau <code>ban</code>.");
      const patch = { action: act };
      if (act === "mute" && args[2]) {
        const sec = parseDuration(args[2]);
        if (sec === null || sec < 30 || sec > 366 * 86400) return card(ctx, E.no, "Durasi tidak valid", "Contoh: <code>30s</code>, <code>10m</code>, <code>2h</code>, <code>1d</code> (30 detik – 366 hari).");
        patch.muteSec = sec;
      }
      const c = await save(patch);
      await richSay(ctx, note(E.ok, "Tindakan diperbarui", `<b>${esc(FLOOD_ACTIONS[act])}</b>${act === "mute" ? ` · ${fmtDuration(c.antiflood.muteSec)}` : ""}`));
      if (c.antiflood.on && act !== "delete") await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
      return;
    }

    return richSay(ctx, status(cur));
  },
};

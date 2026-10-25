import config from "../../config.js";
import { cmdName, genPassword, STAFF_DENY } from "../../src/lib/cpanel/util.js";
import { h, title, table, replyView, replyNote, sendView } from "../../src/lib/richUi.js";
import { isStaff } from "../../src/lib/cpanel/roles.js";
import {
  api, getActiveSlot, getPanel, slotName, findServer, listAll,
  deleteServer, deleteUser, suspendServer, unsuspendServer, changePassword,
} from "../../src/lib/cpanel/ptero.js";

const fmtLimit = (v, unit = "") => (Number(v) === 0 ? "Unlimited" : `${v}${unit}`);

export default {
  command: ["delsrv", "deladp", "suspend", "unsus", "infoserver", "gantipwuser"],
  category: "cpanel",
  description: "Hapus/suspend server, info & ganti pw (Owner+). Contoh: /suspend 12",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    if (!isStaff(ctx.from.id)) return replyView(ctx, STAFF_DENY);
    const cmd = cmdName(ctx);
    const slot = getActiveSlot();
    const p = config.prefix;
    if (!getPanel(slot)) return replyNote(ctx, "✕", `${h(slotName(slot))} belum dikonfigurasi`, `Atur lewat <code>${p}setpanel</code>.`);
    const input = String(args[0] || "").trim();
    const tag = `<i>${h(slotName(slot))}</i>`;
    const usage = (text) => replyNote(ctx, "ℹ️", "Format salah", text);

    // ---------- delsrv ----------
    if (cmd === "delsrv") {
      if (!/^\d+$/.test(input)) return usage(`Contoh: <code>${p}delsrv 12</code> (ID server)`);
      const r = await deleteServer(slot, input);
      if (r.status === 204) return replyNote(ctx, "✅", "Server dihapus", `Server <code>${input}</code> berhasil dihapus. ${tag}`);
      if (r.status === 404) return replyNote(ctx, "✕", "Tidak ditemukan", `Server <code>${input}</code> tidak ditemukan.`);
      return replyNote(ctx, "✕", "Gagal menghapus server", h(r.error));
    }

    // ---------- deladp ----------
    if (cmd === "deladp") {
      if (!/^\d+$/.test(input)) return usage(`Contoh: <code>${p}deladp 3</code> (ID user admin panel)`);
      const g = await api(slot, "GET", `/users/${input}`);
      if (!g.ok) return g.status === 404 ? replyNote(ctx, "✕", "Tidak ditemukan", `User <code>${input}</code> tidak ditemukan.`) : replyNote(ctx, "✕", "Gagal", h(g.error));
      if (!g.data.attributes.root_admin) return replyNote(ctx, "✕", "Bukan admin panel", "Hapus servernya dulu lewat /delsrv, atau gunakan panel langsung.");
      const r = await deleteUser(slot, input);
      if (r.status === 204) return replyNote(ctx, "✅", "Admin dihapus", `Admin <b>${h(g.data.attributes.username)}</b> berhasil dihapus. ${tag}`);
      return replyNote(ctx, "✕", "Gagal menghapus admin", h(r.error));
    }

    // ---------- suspend ----------
    if (cmd === "suspend") {
      if (!input) return usage(`Contoh: <code>${p}suspend 12</code> (ID / UUID server)`);
      const f = await findServer(slot, input);
      if (!f.ok) return replyNote(ctx, "✕", "Gagal", h(f.error));
      const s = f.server;
      if (s.suspended) return replyNote(ctx, "⚠️", "Sudah suspend", "Server sudah dalam keadaan suspend.");
      const r = await suspendServer(slot, s.id);
      return r.ok
        ? replyNote(ctx, "⊘", "Server di-suspend", `Server <b>${h(s.name)}</b> (ID <code>${s.id}</code>) berhasil di-suspend.`)
        : replyNote(ctx, "✕", "Gagal suspend", h(r.error));
    }

    // ---------- unsus ----------
    if (cmd === "unsus") {
      if (!input) return usage(`Contoh: <code>${p}unsus 12</code> atau <code>${p}unsus all</code> (semua server yang di-suspend)`);
      if (input.toLowerCase() === "all") {
        const all = await listAll(slot, "servers");
        if (!all.ok) return replyNote(ctx, "✕", "Gagal", h(all.error));
        const off = all.items.filter((s) => s.suspended);
        if (!off.length) return replyNote(ctx, "✅", "Tidak ada yang di-suspend", "Tidak ada server yang sedang di-suspend.");
        await replyNote(ctx, "⟲", "Meng-unsuspend...", `${off.length} server sedang diproses.`);
        let ok = 0;
        for (const s of off) if ((await unsuspendServer(slot, s.id)).ok) ok++;
        return replyView(
          ctx,
          title("✅", "Unsuspend Selesai") + table(["Info", "Hasil"], [["Berhasil", `${ok}/${off.length} server`]])
        );
      }
      const f = await findServer(slot, input);
      if (!f.ok) return replyNote(ctx, "✕", "Gagal", h(f.error));
      if (!f.server.suspended) return replyNote(ctx, "⚠️", "Tidak di-suspend", "Server tidak sedang di-suspend.");
      const r = await unsuspendServer(slot, f.server.id);
      return r.ok
        ? replyNote(ctx, "✅", "Server di-unsuspend", `Server <b>${h(f.server.name)}</b> berhasil di-unsuspend.`)
        : replyNote(ctx, "✕", "Gagal unsuspend", h(r.error));
    }

    // ---------- infoserver ----------
    if (cmd === "infoserver") {
      if (!input) return usage(`Contoh: <code>${p}infoserver 12</code> (ID / UUID server)`);
      const f = await findServer(slot, input);
      if (!f.ok) return replyNote(ctx, "✕", "Gagal", h(f.error));
      const s = f.server;
      return replyView(
        ctx,
        title("🖥️", `Info Server ${tag}`) +
          table(["Info", "Detail"], [
            ["Nama", `<b>${h(s.name)}</b>`],
            ["ID", `<code>${s.id}</code>`],
            ["UUID", `<code>${h(s.uuid)}</code>`],
            ["User ID", `<code>${s.user}</code>`],
            ["Status", s.suspended ? "⛔ Suspend" : "🟢 Aktif"],
            ["RAM", fmtLimit(s.limits?.memory, " MB")],
            ["Disk", fmtLimit(s.limits?.disk, " MB")],
            ["CPU", fmtLimit(s.limits?.cpu, "%")],
            ["Dibuat", h(String(s.created_at || "-").replace("T", " ").slice(0, 16))],
          ])
      );
    }

    // ---------- gantipwuser ----------
    if (cmd === "gantipwuser") {
      if (!input) return usage(`Contoh: <code>${p}gantipwuser 5</code> atau <code>${p}gantipwuser username [passwordbaru]</code><br>Password baru dikirim lewat DM.`);
      let uid = /^\d+$/.test(input) ? input : null;
      if (!uid) {
        const all = await listAll(slot, "users");
        if (!all.ok) return replyNote(ctx, "✕", "Gagal", h(all.error));
        const u = all.items.find((x) => x.username.toLowerCase() === input.toLowerCase());
        if (!u) return replyNote(ctx, "✕", "Tidak ditemukan", "User panel tidak ditemukan.");
        uid = u.id;
      }
      if (args[1]) await ctx.deleteMessage().catch(() => {}); // sembunyikan password yang diketik di chat
      const newPass = args[1] || genPassword(10);
      if (newPass.length < 8) return replyNote(ctx, "✕", "Password terlalu pendek", "Password minimal 8 karakter.");
      const r = await changePassword(slot, uid, newPass);
      if (!r.ok) return replyNote(ctx, "✕", "Gagal ganti password", h(r.error));
      const msg = title("🔑", "Password Baru") + table(["Info", "Detail"], [["User", `<b>${h(r.user.username)}</b>`], ["Panel", h(slotName(slot))], ["Password", `<code>${h(newPass)}</code>`]]);
      try {
        await sendView(ctx.telegram, ctx.from.id, msg);
        if (ctx.chat.type !== "private") await replyNote(ctx, "✅", "Password diganti", "Detail dikirim lewat DM.");
      } catch {
        await replyNote(ctx, "✅", "Password diganti, tapi DM gagal", "Tekan /start di chat pribadi bot lalu ulangi.");
      }
    }
  },
};

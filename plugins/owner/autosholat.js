import { geocode, getTimings, NotFound } from "../../src/lib/sholat.js";
import { enableAll, disableAll, getGlobal, isGlobalOn, countTargets } from "../../src/lib/sholatReminder.js";
import { PRAYERS, regionName, zoneOfResult, zoneLabel } from "../../src/lib/sholatView.js";
import { isCloneCtx } from "../../src/lib/jadibot.js";
import { richSay, esc } from "../../src/lib/groupUtil.js";
import { note, quote } from "../../src/lib/richUi.js";
import { E } from "../../src/lib/emo.js";

/**
 * Pengingat sholat otomatis — KHUSUS OWNER, berlaku GLOBAL.
 *   /autosholat on Jakarta   -> semua user (chat pribadi) & semua grup otomatis aktif
 *   /autosholat off          -> semua user & grup otomatis nonaktif
 *   /autosholat              -> status + cara pakai
 * Saat ON, user/grup baru yang tercatat setelahnya ikut aktif otomatis.
 * Pengirim jadwal: src/lib/sholatReminder.js (dijalankan dari index.js).
 */
const usage = (cmd) =>
  quote(
    `Nyalakan untuk semua: <code>/${cmd} on Jakarta</code>`,
    `Ganti kota: <code>/${cmd} on Bandung, Jawa Barat</code>`,
    `Matikan untuk semua: <code>/${cmd} off</code>`
  );

export default {
  command: ["autosholat", "pengingatsholat"],
  category: "owner",
  description: "Owner: aktif/nonaktifkan pengingat sholat untuk SEMUA user & grup. Contoh: /autosholat on Jakarta | /autosholat off",
  ownerOnly: true,
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const cmd = "autosholat";
    if (isCloneCtx(ctx)) {
      return richSay(ctx, note(E.warn, "Tidak tersedia di bot clone", "Pengingat sholat otomatis hanya jalan di bot utama."));
    }

    const mode = String(args[0] || "").toLowerCase();
    const g = getGlobal();

    // ── status / bantuan ──
    if (!["on", "off", "aktif", "nonaktif", "mati"].includes(mode)) {
      const on = isGlobalOn();
      const { users, groups } = countTargets();
      const where = on ? `<br>Wilayah: <b>${esc(regionName(g.place))}</b>` : "";
      return richSay(
        ctx,
        note(E.gear, "Pengingat Sholat (Global)", `Status: <b>${on ? "AKTIF" : "nonaktif"}</b> ${on ? E.ok : E.no}${where}<br>Cakupan: <b>${users}</b> user &amp; <b>${groups}</b> grup`) +
          quote(`Bot mengirim pengingat tiap masuk waktu ${PRAYERS.map((p) => p.name).join(", ")} ke semua user dan grup.`) +
          usage(cmd)
      );
    }

    // ── off ──
    if (["off", "nonaktif", "mati"].includes(mode)) {
      const was = isGlobalOn();
      const n = await disableAll();
      return richSay(
        ctx,
        was || n
          ? note(E.ok, "Pengingat sholat dimatikan", `Dinonaktifkan di semua user &amp; grup (<b>${n}</b> chat).`) + quote(`Nyalakan lagi: <code>/${cmd} on ${esc(g?.query || "Jakarta")}</code>`)
          : note(E.info, "Pengingat sholat memang belum aktif", "Tidak ada yang perlu dimatikan.")
      );
    }

    // ── on ──
    const query = args.slice(1).join(" ").trim().slice(0, 100) || (g?.query ?? "");
    if (!query) {
      return richSay(ctx, note(E.info, "Tulis nama kotanya dulu", "Pengingat butuh lokasi supaya waktunya tepat.") + usage(cmd));
    }

    let place;
    try {
      place = await geocode(query);
    } catch (e) {
      if (e instanceof NotFound) return richSay(ctx, note(E.no, "Lokasi tidak ditemukan", "Coba tulis lebih lengkap, contoh: <code>/autosholat on Bandung, Jawa Barat</code>"));
      console.error("[autosholat] geocode gagal");
      return richSay(ctx, note(E.warn, "Pencarian lokasi sedang gangguan", "Layanan lokasi tidak bisa dihubungi. Coba lagi sebentar lagi."));
    }

    let r;
    try {
      r = await getTimings(place);
    } catch (e) {
      console.error("[autosholat] timings:", e?.message || e);
      return richSay(ctx, note(E.warn, "Gagal mengambil jadwal", `Jadwal untuk ${esc(place.label)} belum bisa dihitung. Coba lagi sebentar lagi.`));
    }

    const { users, groups } = await enableAll({ query, place, r, by: ctx.from?.id });

    const wz = zoneLabel(zoneOfResult(r));
    const times = PRAYERS.map((p) => `${p.icon} ${p.name}: <b>${esc(r.times[p.key] || "-")}${wz ? ` ${wz}` : ""}</b>`).join("<br>");
    await richSay(
      ctx,
      note(E.ok, "Pengingat sholat diaktifkan untuk semua", `Wilayah: <b>${esc(regionName(place))}</b><br>Aktif di <b>${users}</b> user &amp; <b>${groups}</b> grup. User/grup baru ikut aktif otomatis.`) +
        quote(`<b>Jadwal hari ini</b>`, times) +
        quote(`Matikan untuk semua: <code>/${cmd} off</code>`)
    );
  },
};

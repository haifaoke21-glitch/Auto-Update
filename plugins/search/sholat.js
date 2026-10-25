import { geocode, getTimings, NotFound } from "../../src/lib/sholat.js";
import { sendRichBlocks } from "../../src/lib/richSend.js";
import { scheduleBlocks, localNow, zoneOfResult, zoneLabel, regionName, dateText } from "../../src/lib/sholatView.js";
import { renderSholatCard, periodOf } from "../../src/lib/sholatCard.js";
import { getSub } from "../../src/lib/sholatReminder.js";
import { escH } from "../../src/lib/util.js";

/**
 * Jadwal sholat semua kota / provinsi / negara, tampil sebagai Rich Message
 * (SCHEDULE, tabel INFORMASI/JADWAL, Detail Tambahan, CATATAN).
 * Inti pencarian lokasi & jadwal ada di src/lib/sholat.js. Pengingat otomatis: plugins/owner/autosholat.js.
 */
const HELP =
  "🕌 Jadwal Sholat — semua kota, provinsi & negara\n\n" +
  "Contoh:\n• /jadwalsholat Jakarta\n• /jadwalsholat Bandung, Jawa Barat\n• /jadwalsholat Jawa Timur\n• /jadwalsholat Malaysia\n• /jadwalsholat Mecca\n• /jadwalsholat London, UK\n\n" +
  "Pengingat otomatis tiap masuk waktu sholat diatur oleh owner bot.";

const ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** Waktu sholat berikutnya (sorot di kartu); lewat Isya -> Subuh besok */
function nextPrayer(times, minutes) {
  for (const k of ORDER) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(times[k] || "");
    if (m && Number(m[1]) * 60 + Number(m[2]) > minutes) return k;
  }
  return "fajr";
}

/**
 * Buat kartu foto jadwal lalu upload sekali untuk mendapat file_id (pesan fotonya langsung dihapus lagi),
 * supaya foto bisa dipasang di atas Rich Message. Gagal apa pun -> null (jadwal tetap terkirim tanpa foto).
 */
async function makeCardId(ctx, o) {
  try {
    const png = await renderSholatCard(o);
    const m = await ctx.telegram.sendPhoto(ctx.chat.id, { source: png, filename: "jadwal-sholat.png" }, {
      disable_notification: true,
      ...(ctx.message?.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {}),
    });
    const id = m?.photo?.at(-1)?.file_id || null;
    if (m?.message_id) ctx.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {});
    return id;
  } catch (e) {
    console.warn("[sholat] kartu foto gagal, kirim tanpa foto:", e?.message);
    return null;
  }
}

export default {
  command: ["jadwalsholat"],
  category: "search",
  description: "Jadwal sholat hari ini untuk semua kota, provinsi & negara. Contoh: /jadwalsholat Bandung, Jawa Barat",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    const query = String(text || "").trim().slice(0, 100);
    if (!query) return ctx.reply(HELP);

    let place;
    try {
      place = await geocode(query);
    } catch (e) {
      if (e instanceof NotFound) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Lokasi tidak ditemukan. Coba tulis lebih lengkap, contoh: /jadwalsholat Bandung, Jawa Barat", { parse_mode: "HTML" });
      console.error("[sholat] geocode semua sumber gagal");
      return ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Layanan pencarian lokasi sedang tidak bisa dihubungi. Coba lagi sebentar lagi.", { parse_mode: "HTML" });
    }

    let r;
    try {
      r = await getTimings(place);
    } catch (e) {
      console.error("[sholat] timings:", e?.stack || e?.message || e);
      return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal menghitung jadwal sholat untuk ${escH(place.label)}. Coba lagi sebentar lagi.`, { parse_mode: "HTML" });
    }

    const zone = zoneOfResult(r);
    const blocks = scheduleBlocks({ place, r, ln: localNow(zone), zone, autoOn: Boolean(getSub(ctx.chat.id)?.enabled) });
    const ln = localNow(zone);
    const photoId = await makeCardId(ctx, {
      title: regionName(place),
      dateText: dateText(ln),
      hijri: r.hijri,
      times: r.times,
      zone: zoneLabel(zone) || r.tz,
      methodName: r.methodName,
      nextKey: nextPrayer(r.times, ln.minutes),
      period: periodOf(r.times, ln.minutes), // warna langit mengikuti waktu sekarang
    });
    try {
      await sendRichBlocks(ctx, blocks, photoId);
    } catch (e) {
      console.error("[sholat] kirim gagal:", e?.message);
      await ctx.reply(`🕌 Jadwal Sholat ${place.label}\n\n` + ["imsak", "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map((k) => `${k}: ${r.times[k]}`).join("\n")).catch(() => {});
    }
  },
};

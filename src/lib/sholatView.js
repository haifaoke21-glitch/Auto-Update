// Tampilan Rich Message jadwal sholat (dipakai /jadwalsholat dan pengingat otomatis /autosholat).
// Susunan: SCHEDULE -> judul -> paragraf -> tabel INFORMASI/JADWAL -> Detail Tambahan (lipat)
//          -> kutipan CATATAN (lipat) -> kutipan penutup -> tombol.
// Dikirim lewat sendRichBlocks() yang otomatis turun ke HTML biasa kalau Rich Message ditolak server.
// Emoji biasa otomatis jadi emoji premium oleh lapisan richEmoji.

export const PRAYERS = [
  { key: "fajr", name: "Subuh", icon: "🌅" },
  { key: "dhuhr", name: "Dzuhur", icon: "☀️" },
  { key: "asr", name: "Ashar", icon: "🌤️" },
  { key: "maghrib", name: "Maghrib", icon: "🌇" },
  { key: "isha", name: "Isya", icon: "🌙" },
];

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const pad = (n) => String(n).padStart(2, "0");

/**
 * Waktu lokal lokasi saat ini. zone = { tz: "Asia/Jakarta" | null, offset: jam | null }.
 * Hasil: { date: "YYYY-MM-DD", minutes: menit sejak 00:00, dow, y, m, d }
 */
export function localNow(zone, at = Date.now()) {
  let y, m, d, hh, mm, dow;
  let ok = false;
  if (zone?.tz) {
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: zone.tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          .formatToParts(new Date(at)).map((x) => [x.type, x.value])
      );
      y = +p.year; m = +p.month; d = +p.day; hh = +p.hour; mm = +p.minute;
      dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      ok = true;
    } catch { /* zona tidak dikenal -> pakai offset */ }
  }
  if (!ok) {
    const t = new Date(at + (Number(zone?.offset) || 0) * 3600000);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); hh = t.getUTCHours(); mm = t.getUTCMinutes(); dow = t.getUTCDay();
  }
  return { date: `${y}-${pad(m)}-${pad(d)}`, minutes: hh * 60 + mm, dow, y, m, d };
}

/** "Sabtu, 17 Oktober 2026" */
export const dateText = (ln) => `${DAYS[ln.dow]}, ${ln.d} ${MONTHS[ln.m - 1]} ${ln.y}`;

/** WIB / WITA / WIT untuk Indonesia, selain itu "GMT+8" dst. */
export function zoneLabel(zone) {
  const tz = zone?.tz;
  if (tz === "Asia/Jakarta" || tz === "Asia/Pontianak") return "WIB";
  if (tz === "Asia/Makassar") return "WITA";
  if (tz === "Asia/Jayapura") return "WIT";
  if (tz) {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName");
      if (part?.value) return part.value;
    } catch { /* lanjut */ }
  }
  const off = Number(zone?.offset);
  if (Number.isFinite(off)) {
    if (off === 7) return "WIB";
    if (off === 8) return "WITA";
    if (off === 9) return "WIT";
    return `GMT${off >= 0 ? "+" : ""}${off}`;
  }
  return "";
}

/** Zona dari hasil getTimings(): IANA (Aladhan) atau offset jam (hitung offline). */
export function zoneOfResult(r) {
  const tz = typeof r?.tz === "string" && r.tz.includes("/") ? r.tz : null;
  return { tz, offset: Number.isFinite(r?.zoneOffset) ? r.zoneOffset : null };
}

/** "Jakarta Dan Sekitarnya" untuk kota, nama biasa untuk provinsi / negara. */
export function regionName(place) {
  const base = String(place?.name || "").trim() || String(place?.label || "").split(",")[0].trim() || "Lokasi";
  return place?.kind === "city" || !place?.kind ? `${base} Dan Sekitarnya` : base;
}

// ── penyusun block ──
const bold = (text) => ({ type: "bold", text });
const para = (text) => ({ type: "paragraph", text });
const head = (text) => ({ type: "heading", text, size: 2 });
const cell = (text, header = false) => ({ align: header ? "center" : "left", valign: "middle", text, ...(header ? { is_header: true } : {}) });
const table = (headRow, rows) => ({
  type: "table",
  is_bordered: true,
  is_striped: true,
  cells: [headRow.map((t) => cell(t, true)), ...rows.map((r) => r.map((t) => cell(t)))],
});
const details = (title, blocks) => ({ type: "details", summary: [bold(title)], blocks });
const quote = (text) => ({ type: "expandable_blockquote", text });

const CATATAN_ARAB = "الله أكبر";

function catatan(methodName, offline) {
  const parts = [
    "Sholat tepat waktu adalah amalan yang dicintai Allah.",
    "Waktu di atas mengikuti perhitungan wilayah setempat; selisih 1–2 menit bisa terjadi, sesuaikan dengan adzan di tempatmu.",
  ];
  if (methodName) parts.push(`Metode: ${methodName}.`);
  if (offline) parts.push("Dihitung offline karena server jadwal sedang tidak bisa dihubungi.");
  return [bold(`⭐ CATATAN ${CATATAN_ARAB} — Allahu Akbar `), parts.join(" ")];
}

/**
 * Pengingat satu waktu sholat (dikirim otomatis saat masuk waktu).
 * @param {{prayer:{key,name}, place, time:string, ln:object, zone:object, methodName?:string, offline?:boolean, moreUrl?:string}} o
 */
export function reminderBlocks({ prayer, place, time, ln, zone, methodName, offline, moreUrl }) {
  const region = regionName(place);
  const wz = zoneLabel(zone);
  return [
    para([bold("🕌 SCHEDULE")]),
    head(`Waktu ${prayer.name} - ${region}`),
    para(`‼️ Pengingat jadwal sholat ${prayer.name} wilayah ${region.replace(/ Dan Sekitarnya$/, " dan sekitarnya")}.`),
    para(`✅ Segera berwudhu dan tunaikan sholat ${prayer.name} tepat waktu. Mari dirikan sholat untuk ketenangan hati dan keberkahan hidup.`),
    table(["📊 INFORMASI", "JADWAL"], [
      ["🪪 Hari, Tanggal", dateText(ln)],
      [`🔄 Waktu ${prayer.name}`, `${time}${wz ? ` ${wz}` : ""}`],
      ["📌 Wilayah", region],
    ]),
    details("🔄 Detail Tambahan", [
      head("🔥 Anjuran Sholat Beruntun"),
      para("Segera laksanakan ibadah setelah adzan berkumandang untuk mendapatkan keutamaan sholat di awal waktu."),
    ]),
    quote(catatan(methodName, offline)),
    quote("❤️ Semoga amal ibadah kita diterima."),
    ...(moreUrl ? [{ type: "buttons", buttons: [{ text: "Jadwal Sholat Lainnya", url: moreUrl, style: "primary" }] }] : []),
  ];
}

const ROWS = [["🌙 Imsak", "imsak"], ["🌅 Subuh", "fajr"], ["🌄 Terbit", "sunrise"], ["☀️ Dzuhur", "dhuhr"], ["🌤️ Ashar", "asr"], ["🌇 Maghrib", "maghrib"], ["🌃 Isya", "isha"]];

/**
 * Jadwal sholat sehari penuh (balasan /jadwalsholat).
 * @param {{place, r:object, ln:object, zone:object, autoOn?:boolean}} o
 */
export function scheduleBlocks({ place, r, ln, zone, autoOn }) {
  const region = regionName(place);
  const wz = zoneLabel(zone);
  const extra = [];
  if (r.hijri) extra.push(["📅 Tanggal Hijriah", r.hijri]);
  if (r.tz) extra.push(["🕐 Zona Waktu", String(r.tz)]);
  if (r.methodName) extra.push(["🧮 Metode", r.methodName]);

  const notes = [place.note, r.offline ? "Dihitung offline karena server jadwal sedang tidak bisa dihubungi (selisih ±1-2 menit)." : null].filter(Boolean);
  const detailBlocks = [
    head("🔔 Pengingat Otomatis"),
    para(autoOn
      ? "Pengingat sholat otomatis sedang aktif di chat ini (diatur oleh owner bot)."
      : "Pengingat sholat otomatis belum aktif. Pengaktifannya diatur oleh owner bot."),
    ...notes.map((n) => para(`ℹ️ ${n}`)),
  ];

  return [
    para([bold("🕌 SCHEDULE")]),
    head(`Jadwal Sholat Hari Ini - ${region}`),
    para(`‼️ Jadwal sholat wilayah ${region.replace(/ Dan Sekitarnya$/, " dan sekitarnya")} untuk hari ini.`),
    table(["📊 INFORMASI", "JADWAL"], [
      ["🪪 Hari, Tanggal", dateText(ln)],
      ...ROWS.map(([label, key]) => [label, `${r.times[key] || "-"}${r.times[key] && r.times[key] !== "-" && wz ? ` ${wz}` : ""}`]),
      ["📌 Wilayah", region],
      ...extra,
    ]),
    details("🔄 Detail Tambahan", detailBlocks),
    quote(catatan(null, false)),
    quote("❤️ Semoga amal ibadah kita diterima."),
  ];
}

const escHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Versi caption (HTML) dari pengingat sholat, dipakai sebagai caption audio adzan supaya audio + teks
 * jadi SATU pesan. Batas caption Telegram 1024 karakter, jadi bagian CATATAN dibuang kalau kepanjangan.
 */
export function reminderCaption({ prayer, place, time, ln, zone, methodName, offline }) {
  const region = regionName(place);
  const wz = zoneLabel(zone);
  const regionShort = region.replace(/ Dan Sekitarnya$/, " dan sekitarnya");
  const rows = [
    ["Hari, Tanggal", dateText(ln)],
    [`Waktu ${prayer.name}`, `${time}${wz ? ` ${wz}` : ""}`],
    ["Wilayah", region],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  const table = rows.map(([k, v]) => `${k.padEnd(w)} : ${v}`).join("\n");

  const head =
    `🕋 <b>Adzan ${escHtml(prayer.name)} telah berkumandang</b>\n\n` +
    `🕌 <b>SCHEDULE</b>\n<b>Waktu ${escHtml(prayer.name)} - ${escHtml(region)}</b>\n\n` +
    `‼️ Pengingat jadwal sholat ${escHtml(prayer.name)} wilayah ${escHtml(regionShort)}.\n` +
    `✅ Segera berwudhu dan tunaikan sholat ${escHtml(prayer.name)} tepat waktu.\n\n` +
    `<pre>${escHtml(table)}</pre>`;
  const note =
    `<blockquote expandable>⭐ <b>CATATAN ${CATATAN_ARAB}</b> — Sholat tepat waktu adalah amalan yang dicintai Allah. ` +
    `Selisih 1–2 menit bisa terjadi, sesuaikan dengan adzan di tempatmu.` +
    `${methodName ? ` Metode: ${escHtml(methodName)}.` : ""}${offline ? " Dihitung offline." : ""}</blockquote>`;
  const foot = `<blockquote>❤️ Semoga amal ibadah kita diterima.</blockquote>`;

  let out = `${head}\n${note}\n${foot}`;
  if (out.length > 1000) out = `${head}\n${foot}`;
  return out;
}

/**
 * Hitung waktu sholat secara offline (tanpa API) — dipakai sebagai cadangan kalau server Aladhan
 * tidak bisa dihubungi. Algoritma posisi matahari ala PrayTimes. Akurasi ±1-2 menit dibanding Aladhan.
 */
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const sin = (d) => Math.sin(rad(d));
const cos = (d) => Math.cos(rad(d));
const tan = (d) => Math.tan(rad(d));
const asin = (x) => deg(Math.asin(x));
const acos = (x) => deg(Math.acos(x));
const atan2 = (y, x) => deg(Math.atan2(y, x));
const arccot = (x) => deg(Math.atan(1 / x));
const fix = (a, b) => { a -= b * Math.floor(a / b); return a < 0 ? a + b : a; };
const fixH = (a) => fix(a, 24);
const fixA = (a) => fix(a, 360);

// id metode Aladhan -> parameter. isha/maghrib berupa derajat atau "menit setelah maghrib".
export const METHODS = {
  1: { name: "University of Islamic Sciences, Karachi", fajr: 18, isha: 18 },
  2: { name: "Islamic Society of North America (ISNA)", fajr: 15, isha: 15 },
  3: { name: "Muslim World League", fajr: 18, isha: 17 },
  4: { name: "Umm Al-Qura University, Makkah", fajr: 18.5, ishaMin: 90 },
  5: { name: "Egyptian General Authority of Survey", fajr: 19.5, isha: 17.5 },
  8: { name: "Gulf Region", fajr: 19.5, ishaMin: 90 },
  9: { name: "Kuwait", fajr: 18, isha: 17.5 },
  10: { name: "Qatar", fajr: 18, ishaMin: 90 },
  11: { name: "Majlis Ugama Islam Singapura", fajr: 20, isha: 18 },
  12: { name: "Union Organization Islamic de France", fajr: 12, isha: 12 },
  13: { name: "Diyanet İşleri Başkanlığı, Turkey", fajr: 18, isha: 17 },
  14: { name: "Spiritual Administration of Muslims of Russia", fajr: 16, isha: 15 },
  16: { name: "Dubai", fajr: 18.2, isha: 18.2 },
  17: { name: "JAKIM, Malaysia", fajr: 20, isha: 18 },
  18: { name: "Tunisia", fajr: 18, isha: 18 },
  19: { name: "Algeria", fajr: 18, isha: 17 },
  20: { name: "Kementerian Agama Republik Indonesia", fajr: 20, isha: 18 },
  21: { name: "Morocco", fajr: 19, isha: 17 },
  22: { name: "Comunidade Islamica de Lisboa", fajr: 18, ishaMin: 77 },
  23: { name: "Jordan", fajr: 18, isha: 18 },
};
export const DEFAULT_METHOD = 3;

function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPos(jd) {
  const D = jd - 2451545.0;
  const g = fixA(357.529 + 0.98560028 * D);
  const q = fixA(280.459 + 0.98564736 * D);
  const L = fixA(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixH(atan2(cos(e) * sin(L), cos(L)) / 15);
  return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - RA };
}

/** Hasil: jam desimal lokal (NaN bila matahari tidak terbit/terbenam pada sudut itu, mis. lintang tinggi). */
export function computeTimes({ lat, lon, year, month, day, tz, method = DEFAULT_METHOD }) {
  const m = METHODS[method] || METHODS[DEFAULT_METHOD];
  const jd0 = julian(year, month, day) - lon / (15 * 24);

  const midDay = (t) => fixH(12 - sunPos(jd0 + t).eqt);
  const angleTime = (angle, t, ccw = false) => {
    const decl = sunPos(jd0 + t).decl;
    const noon = midDay(t);
    const x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    const v = acos(x) / 15; // NaN bila |x|>1
    return noon + (ccw ? -v : v);
  };
  const asrTime = (factor, t) => {
    const decl = sunPos(jd0 + t).decl;
    return angleTime(-arccot(factor + tan(Math.abs(lat - decl))), t);
  };

  // iterasi 2x agar posisi matahari akurat di waktu masing-masing sholat
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / 24]));
    t = {
      fajr: angleTime(m.fajr, p.fajr, true),
      sunrise: angleTime(0.833, p.sunrise, true),
      dhuhr: midDay(p.dhuhr),
      asr: asrTime(1, p.asr),
      sunset: angleTime(0.833, p.sunset),
      isha: m.isha != null ? angleTime(m.isha, p.isha) : 0,
    };
  }
  const maghrib = t.sunset;
  const out = {
    fajr: t.fajr,
    sunrise: t.sunrise,
    dhuhr: t.dhuhr,
    asr: t.asr,
    maghrib,
    isha: m.ishaMin != null ? maghrib + m.ishaMin / 60 : t.isha,
  };

  // Lintang tinggi: batasi Subuh/Isya dengan 1/7 malam bila tidak terdefinisi / terlalu jauh dari matahari terbit/terbenam.
  const night = fixH(t.sunrise - t.sunset);
  const cap = (v, base, angle, ccw) => {
    const portion = (angle || 18) / 60 * night;
    const diff = ccw ? fixH(base - v) : fixH(v - base);
    return Number.isNaN(v) || diff > portion ? (ccw ? base - portion : base + portion) : v;
  };
  if (Number.isFinite(night)) {
    out.fajr = cap(out.fajr, out.sunrise, m.fajr, true);
    if (m.ishaMin == null) out.isha = cap(out.isha, maghrib, m.isha, false);
  }

  const shift = tz - lon / 15;
  const res = {};
  for (const [k, v] of Object.entries(out)) res[k] = fixH(v + shift);
  res.imsak = fixH(res.fajr - 10 / 60);
  return res;
}

/** jam desimal -> "HH:MM" (dibulatkan ke menit terdekat). */
export function fmt(h) {
  if (!Number.isFinite(h)) return "-";
  const total = Math.floor(fixH(h) * 60 + 0.5) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

import axios from "axios";
import { computeTimes, fmt, METHODS, DEFAULT_METHOD } from "./prayerCalc.js";

/**
 * Inti jadwal sholat (dipakai /jadwalsholat dan pengingat otomatis /autosholat).
 * Jadwal sholat semua kota / provinsi / negara.
 *  Lokasi : Nominatim -> Photon -> Open-Meteo (otomatis pindah ke berikutnya kalau satu gagal / diblokir).
 *  Jadwal : Aladhan (2 percobaan) -> hitung offline (src/lib/prayerCalc.js). Jadi tetap ada jawaban
 *           walau server Aladhan tidak bisa dihubungi dari VPS/panel.
 */
const UA = "AzmiStecuMD-Bot/1.0 (Telegram bot jadwal sholat)";
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMES_TTL_MS = 20 * 60 * 1000;
const CACHE_MAX = 500;
const geoCache = new Map();
const timesCache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, params, timeout = 10000) =>
  axios.get(url, { params, timeout, headers: { "User-Agent": UA, Accept: "application/json" } }).then((r) => r.data);
const errText = (e) => (e?.response?.status ? `HTTP ${e.response.status}` : e?.code || e?.message || "unknown");
const setCache = (map, key, value) => {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, { at: Date.now(), value });
};
const fromCache = (map, key, ttl) => {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.value : null;
};

// Nominatim membatasi 1 request/detik -> antre.
let chain = Promise.resolve();
function nominatimGet(params) {
  const job = chain.then(() => get("https://nominatim.openstreetmap.org/search", params, 12000));
  chain = job.catch(() => {}).then(() => sleep(1100));
  return job;
}

// Kode negara -> id metode kalkulasi. Negara lain: metode otomatis Aladhan / Muslim World League (offline).
const METHOD_BY_COUNTRY = {
  ID: 20, SG: 11, MY: 17, BN: 17, TR: 13, SA: 4, EG: 5, PK: 1, BD: 1, AF: 1, IN: 1,
  AE: 16, KW: 9, QA: 10, BH: 8, OM: 8, FR: 12, US: 2, CA: 2, RU: 14, TN: 18, DZ: 19, MA: 21, PT: 22, JO: 23,
};

export class NotFound extends Error {}
export class GeoFailed extends Error {}

const dedupeJoin = (parts) => {
  const seen = new Set();
  return parts
    .filter(Boolean)
    .filter((p) => !seen.has(String(p).toLowerCase()) && seen.add(String(p).toLowerCase()))
    .join(", ");
};

// ---------- geocoder ----------
// Semua mengembalikan { lat, lon, name, state, country, cc, kind: "city"|"region"|"country", tz? } atau null.
const REGION_TYPES = new Set(["state", "province", "region", "state_district", "county", "administrative"]);

async function geoNominatim(query) {
  const list = await nominatimGet({ q: query, format: "jsonv2", addressdetails: 1, limit: 5, "accept-language": "id" });
  if (!Array.isArray(list) || !list.length) return null;
  const r = list.find((x) => ["place", "boundary"].includes(x.category)) || list[0];
  const a = r.address || {};
  const t = r.addresstype || r.type || "";
  return {
    lat: Number(r.lat), lon: Number(r.lon), name: r.name, state: a.state, country: a.country,
    cc: String(a.country_code || "").toUpperCase(),
    kind: t === "country" ? "country" : REGION_TYPES.has(t) ? "region" : "city",
  };
}

async function geoPhoton(query) {
  const data = await get("https://photon.komoot.io/api/", { q: query, limit: 5, lang: "en" }, 10000);
  const f = (data?.features || []).find((x) => ["city", "district", "locality", "county", "state", "country", "other"].includes(x.properties?.type)) || data?.features?.[0];
  if (!f) return null;
  const p = f.properties || {};
  const [lon, lat] = f.geometry?.coordinates || [];
  return {
    lat: Number(lat), lon: Number(lon), name: p.name, state: p.state, country: p.country,
    cc: String(p.countrycode || "").toUpperCase(),
    kind: p.type === "country" ? "country" : ["state", "county"].includes(p.type) ? "region" : "city",
  };
}

async function geoOpenMeteo(query) {
  const [first, ...rest] = query.split(",").map((s) => s.trim()).filter(Boolean);
  const data = await get("https://geocoding-api.open-meteo.com/v1/search", { name: first, count: 10, language: "id", format: "json" }, 10000);
  let list = data?.results || [];
  if (!list.length) return null;
  const hints = rest.map((s) => s.toLowerCase());
  if (hints.length) {
    const match = list.filter((r) => hints.some((h) => [r.admin1, r.admin2, r.country, r.country_code].some((v) => String(v || "").toLowerCase().includes(h))));
    if (match.length) list = match;
  }
  const r = list[0];
  const fc = String(r.feature_code || "");
  return {
    lat: Number(r.latitude), lon: Number(r.longitude), name: r.name, state: r.admin1, country: r.country,
    cc: String(r.country_code || "").toUpperCase(), tz: r.timezone,
    kind: fc.startsWith("PCL") ? "country" : fc === "ADM1" ? "region" : "city",
  };
}

async function capitalOf(cc) {
  try {
    const data = await get(`https://restcountries.com/v3.1/alpha/${cc}`, { fields: "capital,capitalInfo" }, 8000);
    const d = Array.isArray(data) ? data[0] : data;
    const ll = d?.capitalInfo?.latlng;
    if (ll?.length === 2) return { lat: Number(ll[0]), lon: Number(ll[1]), name: d.capital?.[0] || null };
  } catch { /* pakai titik pusat negara */ }
  return null;
}

export async function geocode(query) {
  const key = query.trim().toLowerCase().replace(/\s+/g, " ");
  const cached = fromCache(geoCache, key, GEO_TTL_MS);
  if (cached) return cached;

  let found = null;
  let anyOk = false;
  for (const [src, fn] of [["nominatim", geoNominatim], ["photon", geoPhoton], ["open-meteo", geoOpenMeteo]]) {
    try {
      const r = await fn(query);
      anyOk = true;
      if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) { found = r; break; }
    } catch (e) {
      console.error(`[sholat] geocode ${src}: ${errText(e)}`);
    }
  }
  if (!found) throw anyOk ? new NotFound() : new GeoFailed();

  const place = { ...found, label: dedupeJoin([found.name, found.state, found.country]) || query, note: null };
  if (found.kind === "country" && found.cc) {
    const cap = await capitalOf(found.cc);
    if (cap) {
      place.lat = cap.lat;
      place.lon = cap.lon;
      place.label = `${found.country || found.name}${cap.name ? ` (${cap.name})` : ""}`;
      place.note = `Mengikuti ibu kota${cap.name ? ` ${cap.name}` : ""}. Untuk kota lain tulis nama kotanya.`;
    } else {
      place.label = found.country || found.name;
      place.note = "Mengikuti titik pusat negara. Untuk hasil akurat tulis nama kotanya.";
    }
  } else if (found.kind === "region") {
    place.label = dedupeJoin([found.name, found.country]);
    place.note = "Mengikuti titik pusat wilayah. Untuk hasil akurat tulis nama kotanya.";
  }
  setCache(geoCache, key, place);
  return place;
}

// ---------- jadwal ----------
const clock = (v) => String(v || "-").split(" ")[0];

let aladhanBlockedUntil = 0; // jeda global setelah kena rate limit (429)
async function timingsAladhan(place, method) {
  if (Date.now() < aladhanBlockedUntil) throw new Error("aladhan dijeda (rate limit)");
  const params = { latitude: place.lat, longitude: place.lon };
  if (method) params.method = method;
  const ts = Math.floor(Date.now() / 1000);
  let lastErr;
  for (const url of [`https://api.aladhan.com/v1/timings/${ts}`, "https://api.aladhan.com/v1/timings"]) {
    try {
      const data = await get(url, params, 12000);
      const d = data?.data;
      if (data?.code === 200 && d?.timings) {
        const t = d.timings;
        const h = d.date?.hijri;
        return {
          times: { imsak: clock(t.Imsak), fajr: clock(t.Fajr), sunrise: clock(t.Sunrise), dhuhr: clock(t.Dhuhr), asr: clock(t.Asr), maghrib: clock(t.Maghrib), isha: clock(t.Isha) },
          dateText: d.date?.readable || "",
          hijri: h ? `${h.day} ${h.month?.en} ${h.year} H` : null,
          tz: d.meta?.timezone || null,
          methodName: d.meta?.method?.name || null,
          offline: false,
        };
      }
      lastErr = new Error(`aladhan code ${data?.code}`);
    } catch (e) {
      lastErr = e;
      if (e?.response?.status === 429) { aladhanBlockedUntil = Date.now() + 10 * 60 * 1000; break; }
    }
  }
  throw lastErr || new Error("aladhan gagal");
}

/** Offset UTC (jam) untuk nama zona IANA pada saat ini. */
function offsetOfZone(tz, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - Math.floor(now.getTime() / 1000) * 1000) / 3600000;
}

export async function zoneOf(place) {
  if (place.tz) {
    try { return { tz: place.tz, offset: offsetOfZone(place.tz) }; } catch { /* lanjut */ }
  }
  try {
    const d = await get("https://api.open-meteo.com/v1/forecast", { latitude: place.lat, longitude: place.lon, daily: "sunrise", forecast_days: 1, timezone: "auto" }, 8000);
    if (d?.timezone && Number.isFinite(d.utc_offset_seconds)) return { tz: d.timezone, offset: d.utc_offset_seconds / 3600 };
  } catch (e) {
    console.error(`[sholat] zona waktu: ${errText(e)}`);
  }
  // perkiraan kasar bila semua gagal
  if (place.cc === "ID") return { tz: null, offset: place.lon < 114.9 ? 7 : place.lon < 126.5 ? 8 : 9, approx: true };
  return { tz: null, offset: Math.round(place.lon / 15), approx: true };
}

async function timingsOffline(place, method) {
  const zone = await zoneOf(place);
  const local = new Date(Date.now() + zone.offset * 3600000); // geser agar getUTC* = waktu lokal lokasi
  const m = METHODS[method] ? method : DEFAULT_METHOD;
  const raw = computeTimes({
    lat: place.lat, lon: place.lon, tz: zone.offset, method: m,
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
  });
  let hijri = null;
  try {
    hijri = new Intl.DateTimeFormat("id-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(local);
  } catch { /* tanpa hijriah */ }
  return {
    times: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fmt(v)])),
    dateText: new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(local),
    hijri,
    tz: zone.tz || `UTC${zone.offset >= 0 ? "+" : ""}${zone.offset}${zone.approx ? " (perkiraan)" : ""}`,
    methodName: METHODS[m].name,
    zoneOffset: zone.offset,
    offline: true,
  };
}

export async function getTimings(place, { fresh = false } = {}) {
  const method = METHOD_BY_COUNTRY[place.cc];
  const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}:${method || 0}`;
  const cached = fresh ? null : fromCache(timesCache, key, TIMES_TTL_MS);
  if (cached) return cached;

  let result;
  try {
    result = await timingsAladhan(place, method);
  } catch (e) {
    if (!/dijeda/.test(e?.message || "")) console.error(`[sholat] aladhan gagal (${errText(e)}), pakai hitung offline`);
    result = await timingsOffline(place, method);
  }
  if (!result.offline && !fresh) setCache(timesCache, key, result); // hasil offline tidak di-cache supaya Aladhan dicoba lagi
  return result;
}

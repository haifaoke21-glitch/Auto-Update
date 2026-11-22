// Parser QRIS (EMVCo MPM) + geocoding merchant. Tanpa dependency berat.
import axios from "axios";
import https from "node:https";
import config from "../../config.js";

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) sesuai standar QRIS */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Parse TLV: 2 digit tag + 2 digit panjang + value */
export function parseTLV(str) {
  const out = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const tag = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len) || i + 4 + len > str.length) throw new Error("Struktur QR tidak valid");
    out[tag] = str.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

const tryTLV = (s) => { try { return parseTLV(s); } catch { return null; } };

export function parseQris(raw) {
  const data = String(raw || "").trim();
  if (!/^000201/.test(data)) throw new Error("Bukan format QRIS/EMV (harus diawali 000201)");
  const t = parseTLV(data);

  const crcOk = t["63"] ? crc16(data.slice(0, data.lastIndexOf("6304") + 4)) === t["63"].toUpperCase() : false;

  // Merchant account info: tag 26-51. Tiap PJP/acquirer punya blok sendiri; blok QRIS nasional (ID.CO.QRIS.WWW) memuat NMID.
  const accounts = [];
  for (let n = 26; n <= 51; n++) {
    const tag = String(n);
    if (!t[tag]) continue;
    const sub = tryTLV(t[tag]) || {};
    accounts.push({ tag, guid: sub["00"], pan: sub["01"], mid: sub["02"], criteria: sub["03"] });
  }
  const isNational = (a) => /QRIS/i.test(a.guid || "") && /\.CO\./i.test(a.guid || "");
  // NMID = "ID" + angka (mis. ID1026473582876). Sub-tag 02 milik PJP (DANA, GoPay, dll) BUKAN NMID walau posisinya sama.
  const NMID_RE = /^ID\d{10,16}$/;
  const national = accounts.find(isNational);
  const nmid = (national && NMID_RE.test(national.mid || "") ? national.mid : null) || accounts.map((a) => a.mid).find((m) => NMID_RE.test(m || ""));
  const pjp = accounts.find((a) => !isNational(a)) || accounts[0] || {};
  const pjpMerchantId = pjp.mid && pjp.mid !== nmid ? pjp.mid : undefined;
  const criteria = (national?.criteria) || accounts.find((a) => a.criteria)?.criteria;
  const add = t["62"] ? tryTLV(t["62"]) || {} : {};
  const city = t["60"];

  return {
    crcOk,
    dynamic: t["01"] === "12",
    guid: pjp.guid,
    guids: accounts.map((a) => a.guid).filter(Boolean),
    acquirer: acquirerName(pjp.guid),
    acquirerPan: pjp.pan,
    pjpMerchantId,
    nmid,
    criteria, // UMI/UKE/UME/UBE/URE
    mcc: t["52"],
    currency: t["53"],
    amount: t["54"],
    country: t["58"],
    name: t["59"],
    city,
    cityValid: /[A-Za-z]{3,}/.test(city || ""), // beberapa PJP mengisi kode angka (mis. "0113") alih-alih nama kota
    postal: t["61"],
    terminal: add["07"],
    store: add["03"],
    raw: data,
  };
}

/** "ID.DANA.WWW" -> "DANA", "ID.CO.BCA.WWW" -> "BCA", "COM.GOPAY.WWW" -> "GOPAY" */
export function acquirerName(guid) {
  if (!guid) return undefined;
  const tok = String(guid).toUpperCase().split(".").filter((x) => x && !["ID", "CO", "COM", "WWW", "QRIS"].includes(x));
  return tok[0];
}

const CRITERIA = { UMI: "Usaha Mikro", UKE: "Usaha Kecil", UME: "Usaha Menengah", UBE: "Usaha Besar", URE: "Usaha Reguler/Lainnya" };
export const criteriaLabel = (c) => CRITERIA[c] || c || "-";

// =====================================================================
//  PELACAK LOKASI v3 — multi sumber + penilaian ketat + wilayah (kecamatan) via voting
//  Sumber : Google Places · TomTom · Foursquare (opsional, butuh key) · Photon · Nominatim (OSM)
//  Wilayah: Overpass (batas administrasi OSM) + Nominatim reverse + data alamat tiap sumber
//  Catatan: QRIS TIDAK memuat GPS. Yang ada hanya nama (maks 25 huruf), kota (maks 15 huruf) dan kode pos.
//           Lokasi = tempat usaha yang NAMA-nya cocok DAN berada di kota/kode pos yang tertera di QRIS.
//           Kandidat di luar wilayah QRIS tidak pernah dipilih sebagai hasil utama.
// =====================================================================
const UA = "AzmiStecu-QRIS/3.0 (telegram bot)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const googleKey = () => config?.lacakqris?.googleApiKey || process.env.GOOGLE_PLACES_KEY || "";
const tomtomKey = () => config?.lacakqris?.tomtomApiKey || process.env.TOMTOM_KEY || "";
const fsqKey = () => config?.lacakqris?.foursquareApiKey || process.env.FOURSQUARE_KEY || "";

// Paksa IPv4: banyak panel punya IPv6 rusak (ENETUNREACH) -> sumber gagal diam-diam dan hasil jadi ngawur
const http = axios.create({ httpsAgent: new https.Agent({ keepAlive: true, family: 4 }), proxy: false });
const errMsg = (e) => (e?.response?.status ? `HTTP ${e.response.status}` : e?.code || e?.message || "error");

/** Jalankan satu sumber; kegagalan dicatat di diag (bukan ditelan diam-diam) */
async function run(name, fn, diag) {
  try {
    const r = await fn();
    diag?.ok.add(name);
    return r || [];
  } catch (e) {
    diag?.fail.add(`${name}: ${errMsg(e)}`);
    return [];
  }
}

// ---- throttle Nominatim (maks 1 req/detik sesuai kebijakan OSM) ----
let nomNext = 0;
async function nomThrottle() {
  const at = Math.max(Date.now(), nomNext);
  nomNext = at + 1100;
  if (at > Date.now()) await sleep(at - Date.now());
}

// ---- cache 24 jam (hanya hasil yang tidak dipengaruhi sumber gagal) ----
const cache = new Map();
const TTL = 24 * 3600 * 1000;
const cget = (k) => { const v = cache.get(k); if (v && Date.now() - v.t < TTL) return v.d; cache.delete(k); return undefined; };
const cset = (k, d) => { if (cache.size > 500) cache.delete(cache.keys().next().value); cache.set(k, { t: Date.now(), d }); return d; };


// ---- Tabel wilayah lokal per kode pos (fallback terpercaya saat OSM tidak punya data kecamatan/kelurahan) ----
// Tambahkan kode pos lain di sini bila perlu. lat/lon = titik pusat desa (perkiraan), bukan titik usaha.
export const POSTAL_DB = {
  "46184": {
    kelurahan: "Cilolohan", kecamatan: "Tanjungjaya", kota: "Kabupaten Tasikmalaya", provinsi: "Jawa Barat",
    lat: -7.4106, lon: 108.1019,
  },
};
const postalInfo = (postal) => POSTAL_DB[String(postal || "")] || null;

// ---- util geo & teks ----
export function haversine(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const ABBR = { WRG: "WARUNG", WRNG: "WARUNG", TK: "TOKO", TKO: "TOKO", RM: "RUMAH MAKAN", RMH: "RUMAH", KD: "KEDAI", APT: "APOTEK", TB: "TOKO BANGUNAN", BKRY: "BAKERY", RS: "RUMAH SAKIT", PNG: "PANGKALAN", JL: "JALAN", MIE: "MIE", WR: "WARUNG", DPT: "DEPOT", KP: "KAMPUNG", PD: "PONDOK", PDK: "PONDOK" };
const STOP = new Set(["PT", "CV", "UD", "PD", "NO", "DAN", "THE", "OFFICIAL", "RESMI"]);
// Kata umum: tidak boleh jadi satu-satunya alasan dua nama dianggap sama ("TOKO BERKAH" != "TOKO MAJU")
const GENERIC = new Set(["TOKO", "WARUNG", "KEDAI", "RUMAH", "MAKAN", "STORE", "SHOP", "MART", "CAFE", "KAFE", "RESTO", "RESTORAN", "DEPOT", "AGEN", "KIOS", "USAHA", "GROSIR", "JAYA", "ABADI", "MAJU", "SEJAHTERA", "BERKAH", "BARU", "MANDIRI", "SENTOSA", "UMKM"]);

export function tokens(s = "") {
  const t = String(s).toUpperCase().replace(/&/g, " DAN ").replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of t) for (const x of (ABBR[w] || w).split(" ")) if (!STOP.has(x)) out.push(x);
  return out;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function tokScore(q, c) {
  if (q === c) return 1;
  const m = Math.min(q.length, c.length);
  if (m >= 3 && (c.startsWith(q) || q.startsWith(c))) return 0.85; // nama QRIS dibatasi 25 karakter -> sering terpotong
  const r = 1 - lev(q, c) / Math.max(q.length, c.length);
  return r >= 0.75 ? r * 0.9 : 0;
}

/** 0..1 — seberapa mirip nama merchant QRIS dengan nama tempat kandidat (kata umum berbobot rendah) */
export function nameScore(qName, cName) {
  const qt = tokens(qName), ct = tokens(cName);
  if (!qt.length || !ct.length) return 0;
  const hasDistinct = qt.some((x) => !GENERIC.has(x));
  const wq = (x) => (hasDistinct && GENERIC.has(x) ? 0.35 : 1);
  const wc = (y) => (GENERIC.has(y) ? 0.35 : 1);
  const best = (x, arr) => Math.max(...arr.map((y) => tokScore(x, y)));
  const sum = (arr, w) => arr.reduce((a, x) => a + w(x), 0);
  const recall = qt.reduce((a, x) => a + wq(x) * best(x, ct), 0) / sum(qt, wq);
  const precision = ct.reduce((a, y) => a + wc(y) * best(y, qt), 0) / sum(ct, wc);
  let s = 0.75 * recall + 0.25 * precision;
  // minimal satu kata khas (bukan kata umum) dari nama QRIS harus ada di nama tempat
  if (hasDistinct) {
    const dh = Math.max(...qt.filter((x) => !GENERIC.has(x)).map((x) => best(x, ct)));
    if (dh < 0.75) s *= 0.4;
  } else if (Math.min(...qt.map((x) => best(x, ct))) < 0.75) {
    s *= 0.6; // semua kata umum ("TOKO BERKAH"): semuanya harus cocok
  }
  // nama sama persis tapi spasi beda / terpotong: "BUSITI" vs "BU SITI"
  const cq = qt.join(""), cc = ct.join("");
  if (cq.length >= 5 && cc.length >= 5 && (cc.includes(cq) || cq.includes(cc))) s = Math.max(s, 0.88);
  return Math.min(1, s);
}

export const cleanCity = (c = "") =>
  String(c).toUpperCase().replace(/\b(KOTA ADMINISTRASI|KOTA ADM\.?|ADM\.?|KABUPATEN|KAB\.?|KOTA|KODYA)\b/g, " ").replace(/\s+/g, " ").trim();

const titleCase = (s = "") => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
const normKey = (s = "") => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const cityType = (s = "") => (/\bKAB/i.test(s) ? "kab" : /\b(KOTA|KODYA|ADM)\b/i.test(s) ? "kota" : null);

/** Dua nama kota/kabupaten sama? "Kota Bandung" != "Kabupaten Bandung" != "Bandung Barat" */
function sameCity(a, b) {
  if (!a || !b) return false;
  const ta = cityType(a), tb = cityType(b);
  if (ta && tb && ta !== tb) return false;
  const x = normKey(cleanCity(a)), y = normKey(cleanCity(b));
  if (x.length < 4 || y.length < 4) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.includes(s) && s.length / l.length >= 0.75;
}

/** Rapikan nama wilayah: buang awalan Kecamatan/Kelurahan/Desa, ubah HURUF BESAR jadi Title Case */
const tidy = (s) => {
  if (!s) return null;
  const t = String(s).replace(/^(kecamatan|kec\.?|kelurahan|kel\.?|desa)\s+/i, "").trim();
  if (!t) return null;
  return t === t.toUpperCase() ? titleCase(t) : t;
};

// ---- Telepon: normalisasi ke format Indonesia + validasi ----
/** "+62 812-3456-7890" / "0812 3456 7890" / "(022) 423 1234" -> {local, e164, mobile, display} atau null bila bukan nomor Indonesia yang valid */
export function normPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (/^0062/.test(d)) d = d.slice(2);
  if (/^62/.test(d)) d = "0" + d.slice(2);
  else if (/^8\d{8,11}$/.test(d)) d = "0" + d; // 812... tanpa 0 di depan
  d = d.replace(/^00+/, "0"); // "+62 (0)812" -> 00812
  const mobile = /^08\d{8,11}$/.test(d);
  const landline = /^0[2-7]\d{7,10}$/.test(d);
  const tollfree = /^0(800|804)\d{6,8}$/.test(d);
  if (!mobile && !landline && !tollfree) return null;
  const display = mobile ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : d;
  return { local: d, e164: "+62" + d.slice(1), mobile, display };
}
const phonesOf = (raw) => String(raw || "").split(/[;,/]|\s+atau\s+/i).map(normPhone).filter(Boolean);

const PHONE_W = { "Google Places": 3, OSM: 3, TomTom: 2, Foursquare: 2, "Photon": 1 };
/** Gabungkan nomor dari banyak sumber untuk TEMPAT YANG SAMA; nomor yang didukung lebih banyak sumber menang */
export function resolvePhones(list = []) {
  const m = new Map();
  for (const p of list) {
    const src = /OSM/.test(p.src) ? "OSM" : p.src;
    const e = m.get(p.e164) || { ...p, srcs: new Set() };
    e.srcs.add(src); m.set(p.e164, e);
  }
  const arr = [...m.values()].map((e) => ({ ...e, w: [...e.srcs].reduce((a, x) => a + (PHONE_W[x] ?? 1), 0) }))
    .sort((a, b) => (b.srcs.size - a.srcs.size) || (b.w - a.w));
  if (!arr.length) return { phone: null, alt: [] };
  const top = arr[0];
  return {
    phone: { display: top.display, local: top.local, e164: top.e164, mobile: top.mobile, sources: [...top.srcs], confidence: top.srcs.size >= 2 ? "tinggi" : "sedang" },
    alt: arr.slice(1, 3).map((e) => `${e.display} (${[...e.srcs].join(" + ")})`),
  };
}

// ---- Nominatim ----
async function nominatim(params, path = "search") {
  await nomThrottle();
  const { data } = await http.get(`https://nominatim.openstreetmap.org/${path}`, {
    params: { format: "jsonv2", addressdetails: 1, "accept-language": "id", ...(path === "search" ? { countrycodes: "id", limit: 5 } : {}), ...params },
    headers: { "User-Agent": UA },
    timeout: 15000,
  });
  return data;
}

// ---- Anchor: pusat + radius dari kota (lebar) dan kode pos (sempit) ----
function cityQueries(city) {
  const raw = String(city || "").toUpperCase().trim();
  const cn = titleCase(cleanCity(raw));
  if (!cn) return [];
  return cityType(raw) === "kab"
    ? [`Kabupaten ${cn}, Indonesia`, `${cn}, Indonesia`]
    : [`Kota ${cn}, Indonesia`, `${cn}, Indonesia`];
}

/** return { city, postal, wide, narrow } — masing-masing {lat,lon,limitKm,...} atau null */
async function getAnchors({ city, postal }, diag) {
  const key = `anc3:${city}|${postal}`;
  const hit = cget(key);
  if (hit !== undefined) return hit;
  let cityA = null, postA = null, failed = false;
  city = String(city || ""); // "" = QRIS tidak memuat nama kota yang valid -> hanya kode pos yang dipakai
  const known = postalInfo(postal);
  if (!city && known) city = known.kota; // kota diturunkan dari kode pos (mis. QRIS DANA mengisi "0113")
  const isKab = cityType(city) === "kab";
  try {
    for (const qq of cityQueries(city)) { // kosong bila city "" 
      const arr = (await nominatim({ q: qq, limit: 3 })) || [];
      const c = arr.find((x) => ["boundary", "place"].includes(x.category) && x.boundingbox) || arr.find((x) => x.boundingbox);
      if (c) {
        const [s, n, w, e] = c.boundingbox.map(Number);
        const diagKm = haversine({ lat: s, lon: w }, { lat: n, lon: e });
        cityA = { lat: +c.lat, lon: +c.lon, limitKm: Math.min(isKab ? 45 : 30, Math.max(8, (diagKm / 2) * 1.3)), label: c.display_name, level: "kota" };
        break;
      }
    }
  } catch (e) { failed = true; diag?.fail.add(`Nominatim (kota): ${errMsg(e)}`); }
  let postInfo = null;
  if (postal) {
    try {
      postInfo = await overpassPostal(postal);
      if (postInfo && (!cityA || haversine(postInfo, cityA) <= cityA.limitKm)) {
        postA = { lat: postInfo.lat, lon: postInfo.lon, limitKm: Math.min(12, Math.max(4, postInfo.spreadKm * 2)), label: `kode pos ${postal}`, level: "kodepos", areas: postInfo.areas };
      } else postInfo = null;
    } catch (e) { diag?.fail.add(`Overpass (kode pos): ${errMsg(e)}`); }
  }
  try {
    let p = postal && !postA ? ((await nominatim({ postalcode: postal, country: "Indonesia", limit: 1 })) || [])[0] : null;
    if (!p && postal && !postA) { // Nominatim sering tak punya data kode pos Indonesia -> coba pencarian teks "kodepos kota"
      const alt = ((await nominatim({ q: `${postal} ${titleCase(cleanCity(city))}`.trim(), limit: 3 })) || []).find((x) => String(x.display_name || "").includes(String(postal)) || x.address?.postcode === String(postal));
      if (alt) p = alt;
    }
    if (p) {
      const pt = { lat: +p.lat, lon: +p.lon };
      // kode pos dipercaya hanya bila titiknya masih di dalam wilayah kota QRIS
      if (!cityA || haversine(pt, cityA) <= cityA.limitKm) postA = { ...pt, limitKm: 10, label: p.display_name, level: "kodepos" };
    }
  } catch (e) { failed = true; diag?.fail.add(`Nominatim (kode pos): ${errMsg(e)}`); }
  if (!postA && known) postA = { lat: known.lat, lon: known.lon, limitKm: 6, label: `kode pos ${postal}`, level: "kodepos", areas: [{ name: known.kelurahan, level: 7 }, { name: known.kecamatan, level: 6 }] };
  const out = { city: cityA, postal: postA, wide: cityA || (postA && { ...postA, limitKm: 25 }) || null, narrow: postA || null };
  return failed ? out : cset(key, out); // jangan cache kalau ada yang gagal (jaringan sempat putus)
}

// ---- Sumber kandidat (tiap kandidat membawa `adm` = data wilayah dari sumbernya) ----
async function srcGoogle(q, anchor) {
  const key = googleKey();
  if (!key) return [];
  const body = { textQuery: q, languageCode: "id", regionCode: "ID", pageSize: 5 };
  if (anchor) body.locationBias = { circle: { center: { latitude: anchor.lat, longitude: anchor.lon }, radius: Math.min(50000, anchor.limitKm * 1000) } };
  const { data } = await http.post("https://places.googleapis.com/v1/places:searchText", body, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.addressComponents,places.location,places.googleMapsUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.businessStatus",
    },
    timeout: 15000,
  });
  const comp = (p, t) => p.addressComponents?.find((c) => c.types?.includes(t))?.longText;
  return (data?.places || []).map((p) => ({
    src: "Google Places", name: p.displayName?.text || "", address: p.formattedAddress || "",
    lat: p.location?.latitude, lon: p.location?.longitude, postcode: comp(p, "postal_code") || (p.formattedAddress || "").match(/\b\d{5}\b/)?.[0],
    mapsUri: p.googleMapsUri, phone: p.internationalPhoneNumber || p.nationalPhoneNumber, rating: p.rating, ratingCount: p.userRatingCount,
    kind: p.primaryTypeDisplayName?.text, status: p.businessStatus,
    adm: { w: 2, kecamatan: comp(p, "administrative_area_level_3"), kelurahan: comp(p, "administrative_area_level_4"), kota: comp(p, "administrative_area_level_2"), provinsi: comp(p, "administrative_area_level_1"), jalan: comp(p, "route") },
  }));
}

// TomTom Search API — Points of Interest Search (punya database POI sendiri, tanpa kartu kredit)
async function srcTomTom(q, anchor) {
  const key = tomtomKey();
  if (!key) return [];
  const params = { key, limit: 8, countrySet: "ID", language: "id-ID", idxSet: "POI" };
  if (anchor) Object.assign(params, { lat: anchor.lat, lon: anchor.lon, radius: Math.min(50000, Math.round(anchor.limitKm * 1000)) });
  const { data } = await http.get(`https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(q)}.json`, { params, timeout: 15000 });
  return (data?.results || []).map((r) => {
    const a = r.address || {};
    return {
      src: "TomTom", name: r.poi?.name || "", address: a.freeformAddress || "",
      lat: r.position?.lat, lon: r.position?.lon, postcode: a.postalCode,
      phone: r.poi?.phone, kind: r.poi?.categories?.[0],
      adm: { w: 1, kecamatan: a.municipalitySubdivision, kota: a.countrySecondarySubdivision || a.municipality, provinsi: a.countrySubdivisionName || a.countrySubdivision, jalan: [a.streetName, a.streetNumber && `No. ${a.streetNumber}`].filter(Boolean).join(" ") || null },
    };
  });
}

// Foursquare Places API (places-api.foursquare.com, Service Key sebagai Bearer)
async function srcFoursquare(q, anchor) {
  const key = fsqKey();
  if (!key) return [];
  const params = { query: q, limit: 6 };
  if (anchor) { params.ll = `${anchor.lat},${anchor.lon}`; params.radius = Math.min(100000, Math.round(anchor.limitKm * 1000)); }
  const { data } = await http.get("https://places-api.foursquare.com/places/search", {
    params, timeout: 15000,
    headers: { Authorization: `Bearer ${key}`, "X-Places-Api-Version": "2025-06-17", Accept: "application/json" },
  });
  return (data?.results || []).map((r) => {
    const loc = r.location || {};
    return {
      src: "Foursquare", name: r.name || "", address: loc.formatted_address || [loc.address, loc.locality, loc.region, loc.postcode].filter(Boolean).join(", "),
      lat: r.latitude ?? r.geocodes?.main?.latitude, lon: r.longitude ?? r.geocodes?.main?.longitude,
      postcode: loc.postcode, phone: r.tel, kind: r.categories?.[0]?.name,
      adm: { w: 1, kota: loc.locality, provinsi: loc.region, jalan: loc.address },
    };
  });
}

async function srcPhoton(q, anchor) {
  const params = { q, limit: 8 };
  if (anchor) {
    const d = anchor.limitKm / 111, dl = d / Math.max(0.2, Math.cos((anchor.lat * Math.PI) / 180));
    Object.assign(params, { lat: anchor.lat, lon: anchor.lon, bbox: `${anchor.lon - dl},${anchor.lat - d},${anchor.lon + dl},${anchor.lat + d}` });
  }
  const { data } = await http.get("https://photon.komoot.io/api/", { params, headers: { "User-Agent": UA }, timeout: 12000 });
  return (data?.features || []).filter((f) => f.properties?.countrycode === "ID" || !f.properties?.countrycode).map((f) => {
    const p = f.properties || {};
    const addr = [p.street && `${p.street}${p.housenumber ? " No. " + p.housenumber : ""}`, p.district, p.city || p.county, p.state, p.postcode].filter(Boolean).join(", ");
    return { src: "Photon/OSM", name: p.name || "", address: addr, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], postcode: p.postcode, kind: p.osm_value, adm: null };
  });
}

async function srcNominatim(q, anchor) {
  const params = { q };
  if (anchor) {
    const d = anchor.limitKm / 111, dl = d / Math.max(0.2, Math.cos((anchor.lat * Math.PI) / 180));
    params.viewbox = `${anchor.lon - dl},${anchor.lat + d},${anchor.lon + dl},${anchor.lat - d}`;
    params.bounded = 1; // hanya di dalam wilayah QRIS
  }
  params.extratags = 1; // tag OSM (phone, contact:phone, dll)
  const data = await nominatim(params);
  return (data || []).map((r) => ({
    src: "Nominatim/OSM", name: r.name || r.namedetails?.name || (r.display_name || "").split(",")[0], address: r.display_name,
    lat: +r.lat, lon: +r.lon, postcode: r.address?.postcode, kind: r.type, adm: null,
    phone: ["phone", "contact:phone", "contact:mobile", "mobile", "contact:whatsapp", "whatsapp"].map((k) => r.extratags?.[k]).filter(Boolean).join(";") || undefined,
  }));
}

async function fetchAll(queries, anchor, diag) {
  const jobs = queries.flatMap((x) => [
    run("Google Places", () => srcGoogle(x, anchor), diag),
    run("TomTom", () => srcTomTom(x, anchor), diag),
    run("Foursquare", () => srcFoursquare(x, anchor), diag),
    run("Photon", () => srcPhoton(x, anchor), diag),
  ]);
  return (await Promise.all(jobs)).flat();
}

// ---- Penilaian & pemilihan ----
export function scoreCandidate(c, q, anchors) {
  const ns = nameScore(q.name, c.name);
  const addrN = String(c.address || "").toUpperCase();
  const city = cleanCity(q.city);
  const cityOk = Boolean(city && addrN.includes(city));
  const cp = c.postcode ? String(c.postcode) : null;
  const postalOk = Boolean(q.postal && cp && cp === String(q.postal));
  const postalBad = Boolean(q.postal && cp && cp !== String(q.postal));
  let s = 0.66 * ns + (cityOk ? 0.1 : 0) + (postalOk ? 0.2 : 0) - (postalBad ? 0.06 : 0);

  let distCity = null, distPostal = null, inRange = false, outside = false;
  if (anchors?.city) {
    distCity = haversine(c, anchors.city);
    inRange = distCity <= anchors.city.limitKm;
    outside = distCity > anchors.city.limitKm * 1.25 && !cityOk && !postalOk;
  }
  if (anchors?.postal) {
    distPostal = haversine(c, anchors.postal);
    if (distPostal < 8) s += 0.12 * (1 - distPostal / 8);
    if (distPostal <= anchors.postal.limitKm) inRange = true;
    else if (!anchors.city && !cityOk && !postalOk) outside = true; // tanpa nama kota, kode pos satu-satunya patokan
  }
  if (outside) s *= 0.3; // jauh dari kota di QRIS -> cabang / tempat lain
  const hasAnchor = Boolean(anchors?.city || anchors?.postal);
  const localOk = hasAnchor ? cityOk || postalOk || inRange : true; // tanpa anchor tidak bisa diverifikasi (level tinggi tetap butuh bukti)
  return {
    ...c, nameScore: ns, distKm: distPostal ?? distCity, distPostal, cityOk, postalOk, outside, localOk,
    eligible: ns >= 0.5 && localOk && !outside, score: Math.max(0, Math.min(1, s)),
  };
}

export function pickBest(cands, q, anchors) {
  const scored = cands
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name)
    .map((c) => scoreCandidate(c, q, anchors));
  // Pengecekan silang: sumber lain menunjuk tempat yang sama (<=200 m & nama mirip) -> skor naik
  for (const c of scored) {
    const others = new Set();
    for (const o of scored) {
      if (o !== c && o.src !== c.src && haversine(c, o) <= 0.2 && nameScore(o.name, c.name) >= 0.7) others.add(o.src);
    }
    c.corroborated = [...others];
    c.score = Math.min(1, c.score + 0.05 * Math.min(2, others.size));
  }
  scored.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
  // Gabungkan duplikat (<=60 m & nama mirip): pertahankan skor tertinggi, kumpulkan data wilayah semua sumber
  const kept = [];
  for (const c of scored) {
    const dup = kept.find((k) => haversine(k, c) <= 0.06 && nameScore(k.name, c.name) >= 0.7);
    if (dup) {
      dup.admList.push(...(c.adm ? [{ ...c.adm, src: c.src }] : []));
      if (!dup.phone && c.phone) dup.phone = c.phone;
      if (!dup.postcode && c.postcode) dup.postcode = c.postcode;
      continue;
    }
    c.admList = c.adm ? [{ ...c.adm, src: c.src }] : [];
    kept.push(c);
  }
  // Nomor telepon hanya dari kandidat yang jelas tempat yang sama (<=200 m & nama mirip)
  for (const k of kept) {
    k.phones = [];
    for (const o of scored) {
      if (haversine(k, o) <= 0.2 && nameScore(o.name, k.name) >= 0.7) for (const ph of phonesOf(o.phone)) k.phones.push({ ...ph, src: o.src });
    }
  }
  return kept;
}

// "tinggi" hanya jika nama sangat cocok DAN ada bukti wilayah (kota / kode pos / dekat titik kode pos) yang sama dengan QRIS
export const levelOf = (c) =>
  c.eligible && c.score >= 0.75 && c.nameScore >= 0.8 && (c.postalOk || c.cityOk || (c.distPostal != null && c.distPostal <= 8)) ? "tinggi"
    : c.score >= 0.5 && c.nameScore >= 0.55 ? "sedang" : "rendah";

// ---- Wilayah: kecamatan / kelurahan lewat voting beberapa sumber ----
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

/** Batas administrasi OSM di titik tsb. Indonesia: 4=provinsi, 5=kab/kota, 6=kecamatan, 7=kelurahan/desa.
 *  Dipakai hanya bila level 5 cocok dengan kota yang diharapkan (validasi) — kalau tidak, dibuang. */
async function overpassAdmin(lat, lon, hints) {
  const ql = `[out:json][timeout:15];is_in(${lat},${lon})->.a;area.a[boundary=administrative][admin_level~"^[4-8]$"];out tags;`;
  let data = null, lastErr;
  for (const url of OVERPASS) {
    try {
      ({ data } = await http.post(url, `data=${encodeURIComponent(ql)}`, { headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, timeout: 18000 }));
      if (data?.elements) break;
    } catch (e) { lastErr = e; }
  }
  if (!data?.elements) throw lastErr || new Error("kosong");
  const lv = {};
  for (const el of data.elements) {
    const l = el.tags?.admin_level, n = el.tags?.name;
    if (l && n) (lv[l] ||= []).push(n);
  }
  const kota = (lv[5] || []).find((n) => hints.some((h) => sameCity(n, h)));
  if (!kota) return null;
  return { provinsi: lv[4]?.[0] || null, kota, kecamatan: lv[6]?.[0] || null, kelurahan: lv[7]?.[0] || null };
}

/** Titik & nama wilayah untuk SATU kode pos dari data OSM (batas administrasi / batas kode pos / alamat ber-kode pos).
 *  Memakai median titik supaya outlier tidak merusak. Return {lat,lon,spreadKm,count,areas:[{name,level}]} atau null. */
async function overpassPostal(postal) {
  const ql = `[out:json][timeout:20];(rel["boundary"="administrative"]["postal_code"="${postal}"];rel["boundary"="postal_code"]["postal_code"="${postal}"];nwr["addr:postcode"="${postal}"];);out tags center 80;`;
  let data = null, lastErr;
  for (const url of OVERPASS) {
    try {
      ({ data } = await http.post(url, `data=${encodeURIComponent(ql)}`, { headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, timeout: 25000 }));
      if (data?.elements) break;
    } catch (e) { lastErr = e; }
  }
  if (!data?.elements) throw lastErr || new Error("kosong");
  const pts = [], areas = [];
  for (const e of data.elements) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    if (e.tags?.boundary === "administrative" && e.tags.name) areas.push({ name: e.tags.name, level: Number(e.tags.admin_level) || null });
  }
  if (!pts.length) return null;
  const med = (arr) => { const a = [...arr].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const c = { lat: med(pts.map((x) => x.lat)), lon: med(pts.map((x) => x.lon)) };
  const spread = med(pts.map((x) => haversine(c, x))); // median jarak, tahan outlier
  return { ...c, spreadKm: spread, count: pts.length, areas };
}

/** Tag OSM tempat usaha di sekitar titik (telepon, kode pos, alamat, jam buka) — hanya bila nama cocok */
async function overpassPoi(lat, lon, name) {
  const ql = `[out:json][timeout:15];nwr(around:90,${lat},${lon})["name"];out tags center 40;`;
  let data = null, lastErr;
  for (const url of OVERPASS) {
    try {
      ({ data } = await http.post(url, `data=${encodeURIComponent(ql)}`, { headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, timeout: 18000 }));
      if (data?.elements) break;
    } catch (e) { lastErr = e; }
  }
  if (!data?.elements) throw lastErr || new Error("kosong");
  const el = data.elements.map((e) => ({ t: e.tags || {}, ns: nameScore(name, e.tags?.name) })).filter((x) => x.ns >= 0.7).sort((a, b) => b.ns - a.ns)[0];
  if (!el) return null;
  const t = el.t;
  const raw = [t.phone, t["contact:phone"], t["contact:mobile"], t.mobile, t["contact:whatsapp"], t.whatsapp].filter(Boolean).join(";");
  return {
    phones: phonesOf(raw).map((p) => ({ ...p, src: "Overpass/OSM" })),
    postcode: t["addr:postcode"] || null, city: t["addr:city"] || null,
    street: t["addr:street"] || null, house: t["addr:housenumber"] || null, hours: t.opening_hours || null,
  };
}

/** Alamat terstruktur untuk satu koordinat. adms = data wilayah dari sumber kandidat (ikut voting). */
export async function resolveRegion(lat, lon, { city, adms = [] } = {}, diag = null) {
  const key = `reg3:${lat.toFixed(5)},${lon.toFixed(5)}|${city}`;
  const hit = cget(key);
  if (hit) return hit;

  let a = {}, full = null, nomOk = false;
  try {
    const r = await nominatim({ lat, lon, zoom: 18 }, "reverse");
    a = r?.address || {}; full = r?.display_name || null; nomOk = true;
    diag?.ok.add("Nominatim reverse");
  } catch (e) { diag?.fail.add(`Nominatim reverse: ${errMsg(e)}`); }

  const nomKota = a.city || a.town || a.regency || a.county || null;
  let ov = null;
  try {
    ov = await overpassAdmin(lat, lon, [city, nomKota].filter(Boolean));
    if (ov) diag?.ok.add("Overpass");
  } catch (e) { diag?.fail.add(`Overpass: ${errMsg(e)}`); }

  const kecV = new Map(), kelV = new Map(), used = new Set();
  const vote = (m, name, w, src) => {
    const n = tidy(name); if (!n || !w) return;
    const k = normKey(n); const e = m.get(k) || { name: n, w: 0, src: new Set() };
    e.w += w; e.src.add(src); m.set(k, e); used.add(src);
  };
  if (ov) { vote(kecV, ov.kecamatan, 3, "Overpass/OSM"); vote(kelV, ov.kelurahan, 3, "Overpass/OSM"); }
  for (const k of ["city_district", "district", "subdistrict"]) vote(kecV, a[k], 2, "Nominatim");
  vote(kecV, a.municipality, 1, "Nominatim");
  for (const k of ["village", "suburb", "neighbourhood", "quarter"]) {
    const v = a[k]; if (!v) continue;
    if (/^(kecamatan|kec\.?)\s/i.test(v)) vote(kecV, v, 2, "Nominatim");
    else if (/^(rw|rt)\b/i.test(v)) continue; // RW/RT bukan kelurahan
    else vote(kelV, v, k === "neighbourhood" || k === "quarter" ? 0.5 : 2, "Nominatim");
  }
  for (const d of adms) { vote(kecV, d.kecamatan, d.w || 1, d.src); vote(kelV, d.kelurahan, d.w || 1, d.src); }

  const sorted = (m, skip) => [...m.values()].filter((e) => normKey(e.name) !== skip).sort((x, y) => y.w - x.w);
  const kecL = sorted(kecV, null), kec = kecL[0] || null;
  const kel = sorted(kelV, kec ? normKey(kec.name) : null)[0] || null;
  const alt = kecL[1] && kecL[1].w >= 2 ? kecL[1].name : null;

  const pick = (get) => adms.map(get).find(Boolean) || null;
  const kn = postalInfo(a.postcode);
  const parts = {
    jalan: [a.road || a.pedestrian || a.footway, a.house_number && `No. ${a.house_number}`].filter(Boolean).join(" ") || pick((d) => d.jalan),
    kelurahan: kel?.name || kn?.kelurahan || null,
    kecamatan: kec?.name || kn?.kecamatan || null,
    kecamatanAlt: alt, // sumber lain berbeda pendapat
    kota: ov?.kota || nomKota || kn?.kota || pick((d) => d.kota),
    provinsi: ov?.provinsi || a.state || kn?.provinsi || pick((d) => d.provinsi),
    kodepos: a.postcode || null,
    full,
    wilayahSumber: [...new Set([...(kec?.src || []), ...(kel?.src || [])])].join(" + ") || (used.size ? [...used].join(" + ") : null),
    overpassOk: Boolean(ov),
  };
  return nomOk ? cset(key, parts) : parts;
}

// kompatibilitas lama
export const reverseAddress = (lat, lon) => resolveRegion(lat, lon).catch(() => null);

/** Alamat rapi gaya Indonesia dari bagian-bagian terstruktur */
export function formatAddress(P = {}, fallbackPostal) {
  const arr = [P.jalan, P.kelurahan && `Kel. ${P.kelurahan}`, P.kecamatan && `Kec. ${P.kecamatan}`, P.kota, P.provinsi, P.kodepos || fallbackPostal].filter(Boolean);
  return arr.join(", ");
}

/** Tingkat akurasi berbasis BUKTI: nama + kab/kota (batas administrasi) + kode pos harus cocok dengan QRIS */
export function finalLevel(c) {
  if (c.kotaBad) return "rendah";
  const wilayah = c.kotaOk === true || c.cityOk || (c.noCity && c.postalHit);
  const kodepos = c.postalHit || (c.distPostal != null && c.distPostal <= 3);
  if (c.nameScore >= 0.8 && c.final >= 0.7 && wilayah && kodepos) return "tinggi";
  if (c.nameScore >= 0.6 && c.final >= 0.5 && (wilayah || kodepos)) return "sedang";
  return "rendah";
}

/**
 * Cari lokasi merchant. Return:
 * { level: tinggi|sedang|rendah|area|none (tanpa lat/lon), lat, lon, name, address, parts, source, mapsUri,
 *   phone{display,e164,mobile,sources,confidence}, phoneAlt[], kotaOk, postalHit, postalMiss, nameMatch, qrisName,
 *   alternatives[], anchor, diag } | null
 */
export async function locateMerchant({ name, city, postal, store, cityValid }) {
  if (cityValid === false || !/[A-Za-z]{3,}/.test(city || "")) city = ""; // mis. "0113" bukan nama kota
  const known = postalInfo(postal);
  const cityFromPostal = Boolean(!city && known);
  if (cityFromPostal) city = known.kota; // Kab/Kota diturunkan dari kode pos -> verifikasi Kab/Kota ikut sesuai
  const ck = `loc4:${name}|${city}|${postal}|${store || ""}`;
  const hit = cget(ck);
  if (hit !== undefined) return hit;

  const diag = { ok: new Set(), fail: new Set() };
  const q = { name, city, postal };
  const anchors = await getAnchors(q, diag);
  const cn = titleCase(cleanCity(city));
  const kab = cityType(city) === "kab";
  const expanded = tokens(name).join(" "); // WRG BU TINI -> WARUNG BU TINI
  const base = [...new Set([name, expanded].filter(Boolean))];
  const queries = [...new Set([
    ...(kab ? base.map((n) => `${n} Kabupaten ${cn}`.trim()) : []),
    ...base.map((n) => `${n} ${cn}`.trim()),
    ...base,
    store && store !== name ? `${store} ${cn}`.trim() : null,
    postal ? `${name} ${postal}` : null,
  ].filter(Boolean))].slice(0, 4);

  let cands = [];
  let ranked = [];
  const strong = () => ranked[0] && levelOf(ranked[0]) === "tinggi";

  // Putaran 1: area sempit sekitar kode pos
  if (anchors.narrow) {
    cands = await fetchAll(queries.slice(0, 2), anchors.narrow, diag);
    ranked = pickBest(cands, q, anchors);
  }
  // Putaran 2: seluruh wilayah kota/kabupaten
  if (!strong()) {
    cands = cands.concat(await fetchAll(queries.slice(0, 3), anchors.wide, diag));
    ranked = pickBest(cands, q, anchors);
  }
  // Putaran 3: Nominatim (OSM)
  if (!strong()) {
    for (const x of queries.slice(0, 3)) cands = cands.concat(await run("Nominatim", () => srcNominatim(x, anchors.wide), diag));
    ranked = pickBest(cands, q, anchors);
  }

  // Tahap verifikasi: 3 kandidat teratas dicek ke batas administrasi (Kab/Kota) dan kode pos QRIS
  const pool = ranked.filter((c) => c.eligible).slice(0, 3);
  for (const c of pool) {
    c.parts = await resolveRegion(c.lat, c.lon, { city, adms: c.admList }, diag);
    c.noCity = !city || cityFromPostal;
    c.kotaOk = city && c.parts?.kota ? sameCity(c.parts.kota, city) : null; // true / false / null (tidak diketahui)
    const pcs = [c.postcode, c.parts?.kodepos].filter(Boolean).map(String);
    c.postalHit = Boolean(postal) && pcs.includes(String(postal));
    c.postalMiss = Boolean(postal) && pcs.length > 0 && !c.postalHit;
    c.kotaBad = c.kotaOk === false && !c.postalHit; // titiknya terbukti di kab/kota lain dan kode pos tidak menyelamatkan
    c.final = Math.max(0, Math.min(1, c.score + (c.kotaOk === true ? 0.1 : 0) - (c.kotaBad ? 0.25 : 0) + (c.postalHit && !c.postalOk ? 0.1 : 0)));
  }
  const best = pool.filter((c) => !c.kotaBad).sort((a, b) => b.final - a.final)[0];

  // Data tambahan dari OSM di titik terpilih (telepon, kode pos, alamat)
  let poi = null;
  if (best) {
    try { poi = await overpassPoi(best.lat, best.lon, best.name); diag.ok.add("Overpass POI"); } catch (e) { diag.fail.add(`Overpass POI: ${errMsg(e)}`); }
    if (poi?.postcode && postal) {
      if (String(poi.postcode) === String(postal)) { best.postalHit = true; best.postalMiss = false; }
      else if (!best.postalHit) best.postalMiss = true;
    }
  }
  const ph = best ? resolvePhones([...(best.phones || []), ...(poi?.phones || [])]) : { phone: null, alt: [] };

  const diagOut = () => ({ ok: [...diag.ok], fail: [...diag.fail] });
  const alts = ranked.filter((c) => c !== best && c.nameScore >= 0.5).slice(0, 3).map((c) => ({
    name: c.name, address: c.address, lat: c.lat, lon: c.lon, score: c.final ?? c.score, src: c.src, distKm: c.distKm,
    reason: c.kotaBad ? "kab/kota berbeda dari QRIS" : c.outside || c.eligible === false ? "di luar wilayah QRIS" : null,
  }));

  let result = null;
  if (best) {
    const parts = { ...best.parts };
    if (!parts.jalan && poi?.street) parts.jalan = [poi.street, poi.house && `No. ${poi.house}`].filter(Boolean).join(" ");
    result = {
      level: finalLevel(best), score: best.final, lat: best.lat, lon: best.lon, name: best.name, qrisName: name,
      nameMatch: Math.round(best.nameScore * 100), postalOk: best.postalOk, cityOk: best.cityOk,
      kotaOk: best.kotaOk, postalHit: best.postalHit, postalMiss: best.postalMiss,
      address: best.address || parts.full || "", parts, source: [best.src, ...(best.corroborated || [])].join(" + "),
      mapsUri: best.mapsUri, phone: ph.phone, phoneAlt: ph.alt, hours: poi?.hours || null,
      rating: best.rating, ratingCount: best.ratingCount, kind: best.kind, status: best.status,
      distKm: best.distKm, alternatives: alts, anchor: anchors.postal || anchors.city, diag: diagOut(),
    };
  } else if (anchors.wide) {
    // Tidak ada tempat yang cocok namanya DAN terbukti di kab/kota QRIS -> hanya perkiraan area, bukan lokasi usaha
    const a = anchors.postal || anchors.wide;
    const parts = { ...(await resolveRegion(a.lat, a.lon, { city }, diag)) };
    // Level area = pusat wilayah kode pos, BUKAN alamat usaha: jalan dari titik pusat tidak relevan
    const desa = [...new Set((a.areas || []).filter((x) => x.level >= 7).map((x) => x.name))];
    if (a.level === "kodepos") {
      parts.kodepos = postal;
      if (desa.length === 1) parts.kelurahan = desa[0];
      else if (desa.length > 1) parts.kelurahan = null;
      parts.desaDalamKodePos = desa.length > 1 ? desa.slice(0, 8) : null;
    }
    parts.jalan = null;
    if (known && a.level === "kodepos") {
      // data tabel lebih tepat daripada reverse-geocode titik pusat (yang sering kosong/salah desa)
      parts.kelurahan = known.kelurahan; parts.kecamatan = known.kecamatan; parts.kecamatanAlt = null;
      parts.kota = known.kota; parts.provinsi = known.provinsi; parts.desaDalamKodePos = null;
      parts.wilayahSumber = "Data kode pos lokal";
    } else if (a.level === "kodepos" && !parts.kecamatan) {
      const kec = (a.areas || []).find((x) => x.level === 6);
      if (kec) parts.kecamatan = tidy(kec.name);
    }
    result = {
      level: "area", score: 0, lat: a.lat, lon: a.lon, qrisName: name,
      name: a.level === "kodepos" ? `Area kode pos ${postal}` : titleCase(cn || city || ""),
      address: formatAddress(parts, postal), parts, source: a.level === "kodepos" && a.areas ? "OSM (batas kode pos)" : "Nominatim/OSM",
      alternatives: alts, anchor: a, areaLevel: a.level, noCity: !city, cityFromPostal, kotaOk: known ? true : null, postalHit: Boolean(known), postalMiss: false, diag: diagOut(),
    };
  }
  if (!result) return { level: "none", diag: diagOut() }; // tidak di-cache: bisa jadi hanya jaringan putus
  // Jangan cache bila ada sumber yang gagal (kecuali hasil sudah kuat)
  return diag.fail.size === 0 || result.level === "tinggi" ? cset(ck, result) : result;
}

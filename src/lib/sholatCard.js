// Kartu gambar jadwal sholat (PNG) untuk /jadwalsholat — dipasang di atas Rich Message.
// Gaya sama dengan kartu lain di bot ini: SVG dirender lewat sharp (tanpa emoji agar tidak jadi kotak di VPS/panel).
import sharp from "sharp";

const FONT = "Arial, 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', FreeSans, sans-serif";
const W = 1000;
const H = 840;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

// Tema kartu mengikuti waktu saat ini (langit berubah dari subuh sampai malam).
// sky = [atas, bawah]; sun/moon = posisi benda langit; stars = jumlah bintang.
export const THEMES = {
  night: { label: "MALAM", sky: ["#0a1a3a", "#050c1f"], text: "#f2f6ff", muted: "#a8b8dc", accent: "#e8c46a", box: "rgba(255,255,255,0.07)", boxLine: "rgba(232,196,106,0.30)", hot: ["#f3d889", "#d8a94a"], hotText: "#10192e", frame: "rgba(232,196,106,0.55)", body: "moon", cx: 852, cy: 112, stars: 38 },
  fajr: { label: "SUBUH", sky: ["#1c2b5e", "#f0956a"], text: "#fff7ee", muted: "#ffd9c2", accent: "#ffd27a", box: "rgba(20,25,60,0.38)", boxLine: "rgba(255,210,122,0.40)", hot: ["#ffe2a0", "#ff9f6b"], hotText: "#2a1a3a", frame: "rgba(255,210,122,0.60)", body: "sun", cx: 852, cy: 190, stars: 14 },
  dhuha: { label: "DHUHA", sky: ["#4aa8e8", "#bfe6ff"], text: "#0c2a44", muted: "#2f5878", accent: "#c7790a", box: "rgba(255,255,255,0.55)", boxLine: "rgba(12,42,68,0.18)", hot: ["#ffd45a", "#f5a623"], hotText: "#3a2300", frame: "rgba(12,42,68,0.35)", body: "sun", cx: 840, cy: 140, stars: 0 },
  dhuhr: { label: "DZUHUR", sky: ["#1f86e0", "#9fd8ff"], text: "#08243d", muted: "#1f4a6c", accent: "#b45f00", box: "rgba(255,255,255,0.58)", boxLine: "rgba(8,36,61,0.20)", hot: ["#ffe27a", "#ffb02e"], hotText: "#3a2300", frame: "rgba(8,36,61,0.38)", body: "sun", cx: 850, cy: 98, stars: 0 },
  asr: { label: "ASHAR", sky: ["#e0a13a", "#ffe3a8"], text: "#3a2200", muted: "#6b4710", accent: "#8a4b00", box: "rgba(255,255,255,0.50)", boxLine: "rgba(58,34,0,0.22)", hot: ["#fff0b0", "#ffc04a"], hotText: "#3a2200", frame: "rgba(58,34,0,0.38)", body: "sun", cx: 846, cy: 150, stars: 0 },
  maghrib: { label: "MAGHRIB", sky: ["#3b2a6e", "#ff7a3d"], text: "#fff6ee", muted: "#ffd3b8", accent: "#ffcf6e", box: "rgba(35,18,60,0.40)", boxLine: "rgba(255,207,110,0.42)", hot: ["#ffe08a", "#ff9142"], hotText: "#2a1230", frame: "rgba(255,207,110,0.60)", body: "sun", cx: 852, cy: 205, stars: 10 },
};

/** Tema sesuai waktu sekarang: antara waktu sholat yang sudah lewat dan berikutnya. */
export function periodOf(times, minutes) {
  const at = (k) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(times?.[k] || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const fajr = at("fajr"), sunrise = at("sunrise"), dhuhr = at("dhuhr"), asr = at("asr"), maghrib = at("maghrib"), isha = at("isha");
  if (isha != null && minutes >= isha) return "night";
  if (maghrib != null && minutes >= maghrib) return "maghrib";
  if (asr != null && minutes >= asr) return "asr";
  if (dhuhr != null && minutes >= dhuhr) return "dhuhr";
  if (sunrise != null && minutes >= sunrise) return "dhuha";
  if (fajr != null && minutes >= fajr) return "fajr";
  return "night";
}

// 5-ujung bintang
const star = (cx, cy, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
};

/**
 * @param {{ title:string, dateText:string, hijri?:string|null, times:Record<string,string>, zone?:string, methodName?:string|null, nextKey?:string|null, period?:string }} o
 * times: { imsak, fajr, sunrise, dhuhr, asr, maghrib, isha } "HH:MM". period: kunci THEMES (lihat periodOf()).
 */
export function buildSholatCardSvg({ title, dateText, hijri, times, zone, methodName, nextKey, period }) {
  const C = THEMES[period] || THEMES.night;
  const name = clip(String(title || "Lokasi").toUpperCase(), 26);
  const titleSize = Math.max(32, Math.min(58, Math.floor(730 / (name.length * 0.68)))); // jangan menabrak matahari/bulan di kanan

  const cells = [
    ["Imsak", "imsak"], ["Subuh", "fajr"],
    ["Terbit", "sunrise"], ["Dzuhur", "dhuhr"],
    ["Ashar", "asr"], ["Maghrib", "maghrib"],
    ["Isya", "isha"], [null, null],
  ];
  const colW = 428, rowH = 92, gap = 16, x0 = 60, y0 = 292;
  let grid = "";
  cells.forEach(([label, key], i) => {
    const x = x0 + (i % 2) * (colW + 24);
    const y = y0 + Math.floor(i / 2) * (rowH + gap);
    if (!key) {
      grid += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" rx="20" fill="none" stroke="${C.boxLine}" stroke-width="2" stroke-dasharray="6 8"/>
      <text x="${x + 28}" y="${y + 40}" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="2" fill="${C.muted}">ZONA WAKTU</text>
      <text x="${x + 28}" y="${y + 74}" font-family="${FONT}" font-size="30" font-weight="800" fill="${C.accent}">${esc(clip(String(zone || "-").replace(/_/g, " "), 16))}</text>`;
      return;
    }
    const hot = key === nextKey;
    const time = times?.[key] && times[key] !== "-" ? times[key] : "--:--";
    grid += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" rx="20" fill="${hot ? "url(#hot)" : C.box}" stroke="${hot ? C.accent : C.boxLine}" stroke-width="2"/>
      ${hot ? "" : `<rect x="${x}" y="${y + 22}" width="6" height="${rowH - 44}" rx="3" fill="${C.accent}"/>`}
      <text x="${x + 30}" y="${y + 58}" font-family="${FONT}" font-size="30" font-weight="700" fill="${hot ? C.hotText : C.text}">${esc(label)}</text>
      ${hot ? `<text x="${x + 30}" y="${y + 80}" font-family="${FONT}" font-size="13" font-weight="800" letter-spacing="2" fill="${C.hotText}" opacity="0.75">BERIKUTNYA</text>` : ""}
      <text x="${x + colW - 30}" y="${y + 62}" text-anchor="end" font-family="${FONT}" font-size="46" font-weight="800" fill="${hot ? C.hotText : C.accent}">${esc(time)}</text>`;
  });

  const pillY = y0 + 4 * rowH + 3 * gap + 34;

  // bintang (posisi tetap supaya kartu konsisten), hanya di area langit atas
  let stars = "";
  for (let i = 0; i < (C.stars || 0); i++) {
    const sx = 40 + ((i * 197 + 61) % 920);
    const sy = 40 + ((i * 89 + 23) % 230);
    if (sx < 60 || (sx < 780 && sy > 70 && sy < 270)) continue; // jangan di belakang teks judul
    stars += `<circle cx="${sx}" cy="${sy}" r="${(1.2 + (i % 3) * 0.7).toFixed(1)}" fill="#ffffff" opacity="${(0.45 + (i % 4) * 0.12).toFixed(2)}"/>`;
  }

  // benda langit: matahari (lingkar + sinar halus) atau bulan sabit
  const body =
    C.body === "moon"
      ? `<mask id="moon"><rect width="${W}" height="${H}" fill="black"/><circle cx="${C.cx}" cy="${C.cy}" r="46" fill="white"/><circle cx="${C.cx + 20}" cy="${C.cy - 14}" r="40" fill="black"/></mask>
         <rect width="${W}" height="${H}" fill="url(#hot)" mask="url(#moon)"/>
         <polygon points="${star(C.cx + 53, C.cy - 38, 14)}" fill="${C.accent}"/>`
      : `<circle cx="${C.cx}" cy="${C.cy}" r="120" fill="url(#sunGlow)"/>
         <circle cx="${C.cx}" cy="${C.cy}" r="44" fill="url(#hot)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky[0]}"/><stop offset="1" stop-color="${C.sky[1]}"/></linearGradient>
    <linearGradient id="hot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.hot[0]}"/><stop offset="1" stop-color="${C.hot[1]}"/></linearGradient>
    <radialGradient id="sunGlow"><stop offset="0" stop-color="${C.hot[0]}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.hot[0]}" stop-opacity="0"/></radialGradient>
    <clipPath id="card"><rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="34"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.sky[1]}"/>
  <g clip-path="url(#card)">
    <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="url(#sky)"/>
    ${stars}
    ${body}
  </g>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="34" fill="none" stroke="${C.frame}" stroke-width="3"/>
  <rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="26" fill="none" stroke="${C.frame}" stroke-width="1.5" opacity="0.5"/>

  <text x="60" y="96" font-family="${FONT}" font-size="20" font-weight="800" letter-spacing="5" fill="${C.accent}">JADWAL SHOLAT  •  ${esc(C.label)}</text>
  <text x="60" y="${96 + titleSize + 8}" font-family="${FONT}" font-size="${titleSize}" font-weight="800" fill="${C.text}">${esc(name)}</text>
  <rect x="60" y="${96 + titleSize + 24}" width="84" height="5" rx="2.5" fill="${C.accent}"/>
  <text x="60" y="${96 + titleSize + 70}" font-family="${FONT}" font-size="25" font-weight="700" fill="${C.text}">${esc(dateText)}</text>
  ${hijri ? `<text x="60" y="${96 + titleSize + 102}" font-family="${FONT}" font-size="20" fill="${C.muted}">${esc(clip(hijri, 40))}</text>` : ""}

  ${grid}

  <rect x="60" y="${pillY}" width="${W - 120}" height="46" rx="23" fill="url(#hot)"/>
  <text x="${W / 2}" y="${pillY + 30}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" letter-spacing="1.5" fill="${C.hotText}">SEMOGA AMAL IBADAH KITA DITERIMA</text>
  ${methodName ? `<text x="${W / 2}" y="${pillY + 76}" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${C.muted}">Metode: ${esc(clip(methodName, 70))}</text>` : ""}
</svg>`;
}

/** @returns {Promise<Buffer>} PNG */
export async function renderSholatCard(opts) {
  return sharp(Buffer.from(buildSholatCardSvg(opts))).png().toBuffer();
}

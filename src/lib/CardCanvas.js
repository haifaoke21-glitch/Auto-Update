// Kartu ".id" (renderMemberIdCard) - diekstrak dari src/lib/CardCanvas.js
// Butuh: sharp (sudah ada di package.json)

import sharp from 'sharp';

const CARD_FONT = "Arial, 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', FreeSans, sans-serif";

function escXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function initialsFromName(name) {
  const clean = String(name || '?').trim();
  if (!clean) return '?';
  return clean.charAt(0).toUpperCase();
}

// Beda dari renderPanelCard() & renderInfoCard() di atas: tema warna
// merah/maroon (bukan ungu), avatar TANPA nama nempel di bawahnya (nama udah
// masuk salah satu field di kanan), field kanan ditulis LIST (label+value +
// bullet titik, TANPA kotak border), dan ada "pill bar" solid di bawah buat
// judul kecil/tag.
//
// CATATAN PROPORSI: row field kanan sengaja pakai ROW_H tetap (bukan bagi
// rata tinggi area body kayak buildStatBoxes), terus blok field-nya
// di-center vertikal di area body. Jadi mau body area-nya tinggi atau
// pendek, jarak antar row TETEP proporsional (gak "ketinggian" kalau
// fields dikit / card-nya kebetulan tinggi).
// ══════════════════════════════════════════════════════════════════════════

const MEMBER_CARD_ROW_H = 76;   // jarak antar baris field (tetap, gak stretch)
const MEMBER_CARD_COLS = 2;     // 2 kolom kayak referensi "ID TELEGRAM"

// Avatar khusus member card (pakai warna dari theme, beda dari buildAvatarSvg
// biasa yang warnanya fixed ungu - dipakai bareng fungsi lain jadi gak diubah).
function buildMemberAvatarSvg({ cx, cy, r, avatarBase64, name, c }) {
  if (avatarBase64) {
    return `
    <clipPath id="memberAvatarClip">
      <circle cx="${cx}" cy="${cy}" r="${r}" />
    </clipPath>
    <image href="${avatarBase64}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}"
      clip-path="url(#memberAvatarClip)" preserveAspectRatio="xMidYMid slice" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#memberSunsetStroke)" stroke-width="5" />`;
  }
  const initial = initialsFromName(name);
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#memberAvatarFallback)" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#memberSunsetStroke)" stroke-width="5" />
    <text x="${cx}" y="${cy + 15}" font-family="${CARD_FONT}" font-size="42" font-weight="700"
      fill="${c.avatarInitial}" text-anchor="middle">${escXml(initial)}</text>`;
}

function buildMemberFieldRows(fields, { startX, colW, colGap, centerY, cols = MEMBER_CARD_COLS, rowH = MEMBER_CARD_ROW_H, c }) {
  const rows = Math.ceil(fields.length / cols);
  const blockH = rows * rowH;
  const gridStartY = centerY - blockH / 2 + rowH / 2;

  return fields.map((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (colW + colGap);
    const y = gridStartY + row * rowH;
    const labelY = y - 14;
    const valueY = y + 14;
    const valFontSize = String(f.value).length > 16 ? 18 : 22;

    return `
    <g>
      <circle cx="${x}" cy="${labelY - 5}" r="4" fill="${c.accent}" />
      <text x="${x + 14}" y="${labelY}" font-family="${CARD_FONT}" font-size="12" font-weight="700"
        letter-spacing="0.8" fill="${c.label}">${escXml(String(f.label).toUpperCase())}</text>
      <text x="${x + 14}" y="${valueY}" font-family="${CARD_FONT}" font-size="${valFontSize}" font-weight="800"
        fill="${c.value}">${escXml(f.value)}</text>
    </g>`;
  }).join('\n');
}

/**
 * Bangun markup SVG "Member ID Card" (ala kartu identitas Telegram).
 * @param {Object} opts
 * @param {string} opts.eyebrow      teks kecil pojok kiri atas (mis. "• IDENTITAS • PROFIL MEMBER")
 * @param {string} opts.title        judul besar (mis. "ID TELEGRAM")
 * @param {string} opts.name         dipakai buat inisial avatar fallback (bukan ditulis di bawah avatar)
 * @param {string|null} opts.avatarBase64  data URI avatar (opsional)
 * @param {{label:string, value:string}[]} opts.fields  field2 (urutan row-major, 2 kolom - lihat contoh di bawah)
 * @param {string} opts.pillText     teks di pill bar bawah (mis. "CARD USER INFO • PROFILE CARD")
 * @param {string} opts.footerLeft   teks kecil pojok kiri bawah (mis. "USERBOT ENTERPRISE CATA")
 * @param {string} opts.footerRight  teks kecil pojok kanan bawah (mis. tanggal/jam)
 *
 * Contoh urutan `fields` biar hasilnya row-major 2 kolom kayak referensi:
 *   [ {label:'ID Pengguna', value:'8749021522'}, {label:'Pusat Data (DC)', value:'DO 5 - Singapore'},
 *     {label:'Username',    value:'@budisantoso'}, {label:'Premium',        value:'YA'},
 *     {label:'Nama Akun',   value:'Budi Santoso'},  {label:'Status Label',   value:'TIDAK'} ]
 */
// ── Palet warna siap pakai. Tinggal pilih salah satu key ini lewat
// opts.theme, atau override manual lewat opts.colors (lihat MEMBER_CARD_THEMES.crimson
// buat liat semua key warna yang bisa di-override).
const MEMBER_CARD_THEMES = {
  crimson: { // versi awal (merah/maroon)
    bg: ['#170606', '#220909', '#2c0d0d'], glow1: '#ef4444', glow2: '#b91c2c',
    accent: '#ef4b57', accentDim: 'rgba(239,75,87,0.85)', accentFaint: 'rgba(239,75,87,0.4)',
    eyebrow: '#e07a7a', label: '#c99a97', value: '#f7ecec', title: '#ffffff',
    avatarFallback: ['#4a1414', '#180606'], avatarInitial: '#f4e6c8',
    pillGrad: ['#e14a4a', '#a8202b'], pillText: '#fff5f5',
    footerText: 'rgba(255,255,255,0.35)', canvasBg: '#0c0303'
  },
  navyGold: { // navy tua + gold - kesan premium/elegan, kontras adem
    bg: ['#040a14', '#071224', '#0a1830'], glow1: '#c9a24b', glow2: '#1e3a8a',
    accent: '#d4af6a', accentDim: 'rgba(212,175,106,0.85)', accentFaint: 'rgba(212,175,106,0.35)',
    eyebrow: '#c9a24b', label: '#8fa3c9', value: '#f5f2e8', title: '#ffffff',
    avatarFallback: ['#1e3a8a', '#050b18'], avatarInitial: '#f0dfae',
    pillGrad: ['#b8862f', '#7a5a1e'], pillText: '#fff8e8',
    footerText: 'rgba(255,255,255,0.32)', canvasBg: '#03060c'
  },
  emerald: { // emerald tua + gold pucat - elegan, calm, "private club" vibe
    bg: ['#04120c', '#061e14', '#08281b'], glow1: '#10b981', glow2: '#065f46',
    accent: '#34d399', accentDim: 'rgba(52,211,153,0.85)', accentFaint: 'rgba(52,211,153,0.35)',
    eyebrow: '#6ee7b7', label: '#7fae9c', value: '#eafaf3', title: '#ffffff',
    avatarFallback: ['#065f46', '#03130d'], avatarInitial: '#eafaf3',
    pillGrad: ['#0f9e6e', '#065f46'], pillText: '#eafff5',
    footerText: 'rgba(255,255,255,0.32)', canvasBg: '#020a06'
  },
  charcoalRose: { // charcoal gelap + rose gold - netral, modern, minimalis
    bg: ['#0e0c0d', '#161213', '#1e1719'], glow1: '#e8b4b8', glow2: '#5b4245',
    accent: '#d99aa0', accentDim: 'rgba(217,154,160,0.85)', accentFaint: 'rgba(217,154,160,0.35)',
    eyebrow: '#d99aa0', label: '#a89093', value: '#f6eeef', title: '#ffffff',
    avatarFallback: ['#5b4245', '#120e0f'], avatarInitial: '#f6eeef',
    pillGrad: ['#c98a90', '#8a5b60'], pillText: '#fff3f4',
    footerText: 'rgba(255,255,255,0.32)', canvasBg: '#0a0808'
  },
  slateIce: { // deep slate + ice blue - clean, techy, modern
    bg: ['#0d1117', '#141b26', '#1a212e'], glow1: '#38bdf8', glow2: '#0c4a6e',
    accent: '#7dd3fc', accentDim: 'rgba(125,211,252,0.85)', accentFaint: 'rgba(125,211,252,0.32)',
    eyebrow: '#7dd3fc', label: '#7a8aa3', value: '#f1f6fb', title: '#ffffff',
    avatarFallback: ['#0c4a6e', '#0a0f16'], avatarInitial: '#e6f6ff',
    pillGrad: ['#2b8fc4', '#0c4a6e'], pillText: '#eaf7ff',
    footerText: 'rgba(255,255,255,0.32)', canvasBg: '#080b10'
  }
};

function buildMemberIdCardSvg(opts) {
  const {
    eyebrow = '• IDENTITAS • PROFIL MEMBER',
    title = 'ID TELEGRAM',
    name = 'user',
    avatarBase64 = null,
    fields = [],
    pillText = 'CARD USER INFO • PROFILE CARD',
    footerLeft = 'USERBOT ENTERPRISE CATA',
    footerRight = '',
    theme = 'crimson',
    colors = {}
  } = opts;

  const c = { ...MEMBER_CARD_THEMES[theme] || MEMBER_CARD_THEMES.crimson, ...colors };

  const W = 1000, H = 560;
  const margin = 40;

  // ===== header: eyebrow, title + underline, divider bertitik =====
  const eyebrowY = 66;
  const titleY = 112;
  const underlineY = 124;
  const dividerY = 156;

  // ===== footer: pill bar solid + teks kecil di bawahnya =====
  const pillH = 54;
  const footerTextY = H - 22;
  const pillY = footerTextY - 34 - pillH;

  // ===== body (avatar kiri + field kanan) =====
  const bodyTop = dividerY + 24;
  const bodyBottom = pillY - 26;
  const bodyCenterY = (bodyTop + bodyBottom) / 2;

  const leftColW = 232;
  const avatarCx = margin + 24 + leftColW / 2;
  const avatarCy = bodyCenterY;
  const avatarR = 72;

  const rightX = margin + 24 + leftColW + 40;
  const rightW = W - margin - rightX;
  const colGap = 56;
  const colW = (rightW - colGap) / 2;

  const fieldsSvg = buildMemberFieldRows(fields, {
    startX: rightX,
    colW,
    colGap,
    centerY: bodyCenterY,
    c
  });

  const avatarSvg = buildMemberAvatarSvg({ cx: avatarCx, cy: avatarCy, r: avatarR, avatarBase64, name, c });

  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="idBgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.bg[0]}" />
      <stop offset="55%" stop-color="${c.bg[1]}" />
      <stop offset="100%" stop-color="${c.bg[2]}" />
    </linearGradient>
    <radialGradient id="idWarmGlow" cx="82%" cy="12%" r="60%">
      <stop offset="0%" stop-color="${c.glow1}" stop-opacity="0.20" />
      <stop offset="55%" stop-color="${c.glow1}" stop-opacity="0.07" />
      <stop offset="100%" stop-color="${c.glow1}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="idCornerGlow" cx="8%" cy="96%" r="55%">
      <stop offset="0%" stop-color="${c.glow2}" stop-opacity="0.18" />
      <stop offset="100%" stop-color="${c.glow2}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="memberSunsetStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.accent}" />
      <stop offset="100%" stop-color="${c.glow2}" />
    </linearGradient>
    <linearGradient id="memberAvatarFallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.avatarFallback[0]}" />
      <stop offset="100%" stop-color="${c.avatarFallback[1]}" />
    </linearGradient>
    <linearGradient id="idPillGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${c.pillGrad[0]}" />
      <stop offset="100%" stop-color="${c.pillGrad[1]}" />
    </linearGradient>
    <clipPath id="idCardClip">
      <rect x="${margin}" y="${margin}" width="${W - margin * 2}" height="${H - margin * 2}" rx="26" ry="26" />
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${W}" height="${H}" fill="${c.canvasBg}" />

  <g clip-path="url(#idCardClip)">
    <rect x="${margin}" y="${margin}" width="${W - margin * 2}" height="${H - margin * 2}" fill="url(#idBgGrad)" />
    <rect x="${margin}" y="${margin}" width="${W - margin * 2}" height="${H - margin * 2}" fill="url(#idWarmGlow)" />
    <rect x="${margin}" y="${margin}" width="${W - margin * 2}" height="${H - margin * 2}" fill="url(#idCornerGlow)" />
  </g>

  <!-- garis tepi kartu: outer faint frame + border utama + inner hairline,
       biar ada "kedalaman" (efek 3 lapis) bukan cuma 1 garis polos -->
  <rect x="${margin - 8}" y="${margin - 8}" width="${W - (margin - 8) * 2}" height="${H - (margin - 8) * 2}"
    rx="32" ry="32" fill="none" stroke="${c.accentFaint}" stroke-width="1.5" />
  <rect x="${margin}" y="${margin}" width="${W - margin * 2}" height="${H - margin * 2}" rx="26" ry="26"
    fill="none" stroke="${c.accentDim}" stroke-width="4" />
  <rect x="${margin + 6}" y="${margin + 6}" width="${W - (margin + 6) * 2}" height="${H - (margin + 6) * 2}"
    rx="20" ry="20" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.5" />

  <!-- aksen tepi canvas: dulu cuma bracket-L di 4 pojok doang, sekarang
       disambung jadi 1 garis utuh keliling penuh, pojok LANCIP (rx=0,
       beda sama border card yang rounded) + warna dipudarin dikit biar
       gak nabrak/kembar sama border card di atas (elemen terpisah) -->
  <!-- aksen tepi canvas: nempel LANGSUNG ke pinggir foto/PNG, pojok LANCIP
       (rx=0, siku tegas - BEDA sama border card yang rounded) -->
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}"
    fill="none" stroke="${c.accentDim}" stroke-width="3" opacity="0.55" />

  <!-- eyebrow -->
  <text x="${margin + 24}" y="${eyebrowY}" font-family="${CARD_FONT}" font-size="13" font-weight="700"
    letter-spacing="1.1" fill="${c.eyebrow}">${escXml(eyebrow.toUpperCase())}</text>

  <!-- judul besar + underline aksen -->
  <text x="${margin + 24}" y="${titleY}" font-family="${CARD_FONT}" font-size="34" font-weight="800"
    fill="${c.title}">${escXml(title.toUpperCase())}</text>
  <rect x="${margin + 24}" y="${underlineY}" width="70" height="4" rx="2" fill="${c.accent}" />

  <!-- divider bertitik -->
  <circle cx="${margin + 24}" cy="${dividerY}" r="4.5" fill="${c.accent}" />
  <line x1="${margin + 34}" y1="${dividerY}" x2="${W - margin - 34}" y2="${dividerY}" stroke="${c.accentFaint}" stroke-width="1.5" />
  <circle cx="${W - margin - 24}" cy="${dividerY}" r="4.5" fill="${c.accent}" />

  <!-- kolom kiri: avatar (center vertikal, TANPA nama di bawahnya) -->
  <g>${avatarSvg}</g>

  <!-- kolom kanan: list field 2 kolom -->
  ${fieldsSvg}

  <!-- pill bar bawah -->
  <rect x="${margin + 24}" y="${pillY}" width="${W - (margin + 24) * 2}" height="${pillH}" rx="${pillH / 2}"
    fill="url(#idPillGrad)" />
  <text x="${W / 2}" y="${pillY + pillH / 2 + 6}" text-anchor="middle" font-family="${CARD_FONT}"
    font-size="15" font-weight="800" letter-spacing="1" fill="${c.pillText}">${escXml(pillText.toUpperCase())}</text>
</svg>`;
}

/**
 * Render "Member ID Card" jadi PNG buffer, siap dikirim lewat xy.telegram.sendPhoto.
 * @returns {Promise<Buffer>}
 */
async function renderMemberIdCard(opts) {
  const svg = buildMemberIdCardSvg(opts);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export { buildMemberIdCardSvg, renderMemberIdCard, MEMBER_CARD_THEMES };

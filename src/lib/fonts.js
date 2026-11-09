import fs from "fs";
import path from "path";
import { GlobalFonts } from "@napi-rs/canvas";

/**
 * Loader font untuk canvas (qc dll):
 *  1. font sistem (loadSystemFonts)
 *  2. semua font di data/fonts (rekursif) -> otomatis jadi pilihan + fallback
 *  3. stack fallback lintas bahasa/simbol/emoji supaya karakter tidak jadi kotak
 */
const FONT_DIR = path.join(process.cwd(), "data", "fonts");
const FONT_EXT = /\.(ttf|otf|ttc|woff2?)$/i;

// Urutan fallback: Latin -> CJK -> script lain -> simbol/math -> emoji -> last resort.
const PREFERRED_FALLBACKS = [
  "Noto Sans", "Roboto", "Open Sans", "Liberation Sans", "DejaVu Sans", "FreeSans", "Arial",
  "Noto Sans CJK JP", "Noto Sans CJK SC", "Noto Sans CJK KR", "Noto Sans CJK TC",
  "Noto Sans JP", "Noto Sans SC", "Noto Sans KR", "WenQuanYi Zen Hei", "Source Han Sans",
  "Noto Sans Arabic", "Noto Naskh Arabic", "Noto Sans Hebrew", "Noto Sans Devanagari",
  "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Thai", "Noto Sans Georgian",
  "Noto Sans Armenian", "Noto Sans Ethiopic", "Noto Sans Javanese", "Noto Sans Balinese",
  "Noto Sans Symbols", "Noto Sans Symbols 2", "Noto Sans Math", "Noto Music",
  "DejaVu Math TeX Gyre", "Segoe UI Symbol", "Symbola", "FreeSerif",
  "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", "Noto Emoji",
  "Unifont", "Unifont Sample",
];

const ALIASES = {
  serif: ["Noto Serif", "Liberation Serif", "DejaVu Serif", "Times New Roman"],
  sans: ["Noto Sans", "Liberation Sans", "DejaVu Sans", "Arial"],
  mono: ["Noto Sans Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New"],
  monospace: ["Noto Sans Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New"],
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const quote = (f) => (/^(serif|sans-serif|monospace|cursive|fantasy)$/.test(f) ? f : `"${f.replace(/"/g, "")}"`);

let ready = false;
let userFamilies = [];
let fallbackStack = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (FONT_EXT.test(e.name)) out.push(full);
  }
  return out;
}

const familyNames = () => GlobalFonts.families.map((f) => f.family);

export function initFonts() {
  if (ready) return;
  ready = true;

  try { GlobalFonts.loadSystemFonts?.(); } catch {}

  const before = new Set(familyNames());
  let loaded = 0;
  try {
    fs.mkdirSync(FONT_DIR, { recursive: true });
    for (const file of walk(FONT_DIR)) {
      try {
        if (GlobalFonts.registerFromPath(file)) loaded++;
      } catch (e) {
        console.error(`[FONT] gagal memuat ${path.basename(file)}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error("[FONT] data/fonts:", e.message);
  }

  const all = familyNames();
  userFamilies = all.filter((f) => !before.has(f));

  const installed = new Map(all.map((f) => [f.toLowerCase(), f]));
  const picked = PREFERRED_FALLBACKS.map((f) => installed.get(f.toLowerCase())).filter(Boolean);
  fallbackStack = [...new Set([...picked, ...userFamilies])];

  console.log(`[FONT] ${all.length} family tersedia, ${loaded} file dari data/fonts, ${fallbackStack.length} fallback aktif`);
}

/** Daftar family yang bisa dipilih (unik, urut abjad). */
export function listFamilies() {
  initFonts();
  return [...new Set(familyNames())].sort((a, b) => a.localeCompare(b));
}

/** Cari family dari input user: alias (serif/mono/sans), exact, prefix, lalu contains. */
export function resolveFamily(query) {
  initFonts();
  const q = norm(query);
  if (!q) return null;
  const all = listFamilies();

  for (const cand of ALIASES[q] || []) {
    const hit = all.find((f) => f.toLowerCase() === cand.toLowerCase());
    if (hit) return hit;
  }
  return (
    all.find((f) => norm(f) === q) ||
    all.find((f) => norm(f).startsWith(q)) ||
    all.find((f) => norm(f).includes(q)) ||
    null
  );
}

/** String untuk ctx.font: font utama + seluruh fallback + generic. */
export function fontStack(primary) {
  initFonts();
  const list = [...new Set([primary, ...fallbackStack].filter(Boolean))];
  return [...list.map(quote), "sans-serif"].join(", ");
}

export function suggestFamilies(query, limit = 5) {
  const q = norm(query);
  return listFamilies()
    .filter((f) => q && (norm(f).includes(q.slice(0, 3)) || q.includes(norm(f).slice(0, 3))))
    .slice(0, limit);
}

/** Daftar font untuk balasan /qc fonts & /brat fonts. */
export function fontListMessage(cmd = "/qc") {
  const fams = listFamilies();
  const shown = fams.slice(0, 60).join(", ");
  const more = fams.length > 60 ? `\n… dan ${fams.length - 60} lainnya.` : "";
  return (
    `🔤 Font tersedia (${fams.length}):\n${shown}${more}\n\n` +
    `Pakai: ${cmd} font=NamaFont teks\nAtau: ${cmd} font="Noto Sans" teks\nAlias: serif, sans, mono\n\n` +
    `Tambah font baru: taruh file .ttf/.otf/.ttc di folder data/fonts lalu restart bot.`
  );
}

// font=Poppins | font="Noto Sans" | f:serif   (tanda kutip lurus / melengkung)
const FONT_OPT = /^(?:font|f)\s*[=:]\s*(?:["“”'‘’]([^"“”'‘’]+)["“”'‘’]|(\S+))\s*/i;

/**
 * Ambil opsi font di awal input. Return { family, rest, error }.
 * family = nama family hasil resolve (atau null kalau tidak ada opsi), error = pesan siap kirim bila font tidak ketemu.
 */
export function extractFontOption(input = "", cmd = "/qc") {
  const m = String(input).match(FONT_OPT);
  if (!m) return { family: null, rest: String(input).trim(), error: null };
  const wanted = (m[1] || m[2]).trim();
  const family = resolveFamily(wanted);
  if (!family) {
    const sug = suggestFamilies(wanted);
    return {
      family: null,
      rest: "",
      error:
        `❌ Font "${wanted}" tidak ditemukan.` +
        (sug.length ? `\nMungkin maksud kamu: ${sug.join(", ")}` : "") +
        `\n\nLihat daftar: ${cmd} fonts`,
    };
  }
  return { family, rest: String(input).slice(m[0].length).trim(), error: null };
}

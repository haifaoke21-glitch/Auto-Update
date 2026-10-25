// ============================================================
//  FLUTTERMOD — ubah project Flutter (ZIP) tanpa membuka kodenya:
//  ganti domain/URL, warna, icon & nama aplikasi.
//  Diport dari fluttermod.js (CommonJS) ke ESM, dengan perbaikan:
//   • replace memakai fungsi (teks user yang berisi "$&" / "$1" tidak lagi merusak hasil)
//   • hanya membaca file yang relevan (.dart / .yaml / .xml / .gradle / .plist), folder build & .dart_tool dilewati
//   • pubspec.yaml dikenali walau project ada di dalam sub-folder ZIP
// ============================================================
import AdmZip from "adm-zip";
import sharp from "sharp";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lowerName = (e) => e.entryName.toLowerCase();
const SKIP = /(^|\/)(\.dart_tool|build|\.git|node_modules|\.gradle|\.idea)\//;
const skip = (entry) => entry.isDirectory || SKIP.test(entry.entryName.toLowerCase());
const hasExt = (entry, exts) => exts.some((x) => lowerName(entry).endsWith(x));
const readText = (entry) => {
  try { return entry.getData().toString("utf8"); } catch { return null; }
};
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gradleEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
const isPubspec = (lower) => lower === "pubspec.yaml" || lower.endsWith("/pubspec.yaml");

// ─── DOMAIN ──────────────────────────────────────────────────
/** Semua base URL (protocol://host[:port]) unik di file .dart, urut dari yang paling sering muncul */
export function scanUrlsInZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const counts = new Map();
  for (const entry of zip.getEntries()) {
    if (skip(entry) || !hasExt(entry, [".dart"])) continue;
    const content = readText(entry);
    if (!content) continue;
    for (const m of content.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      const base = (m[0].match(/^(https?:\/\/[^/\s"'`)]+)/) || [])[1] || m[0];
      counts.set(base, (counts.get(base) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function replaceDomainInZip(inZip, outZip, oldUrl, newUrl) {
  const zip = new AdmZip(inZip);
  const re = new RegExp(escapeRegExp(oldUrl), "g");
  let total = 0;
  const changedFiles = [];
  for (const entry of zip.getEntries()) {
    if (skip(entry) || !hasExt(entry, [".dart"])) continue;
    const content = readText(entry);
    if (!content || !content.includes(oldUrl)) continue;
    let count = 0;
    const next = content.replace(re, () => (count++, newUrl));
    if (!count) continue;
    zip.updateFile(entry, Buffer.from(next, "utf8"));
    total += count;
    changedFiles.push({ file: entry.entryName, count });
  }
  if (total) zip.writeZip(outZip);
  return { changedFiles, totalOccurrences: total };
}

// ─── WARNA ───────────────────────────────────────────────────
/** Warna hex RRGGBB paling sering dipakai di .dart (putih/hitam polos dilewati) */
export function scanDominantColors(zipPath) {
  const zip = new AdmZip(zipPath);
  const counts = new Map();
  for (const entry of zip.getEntries()) {
    if (skip(entry) || !hasExt(entry, [".dart"])) continue;
    const content = readText(entry);
    if (!content) continue;
    for (const m of content.matchAll(/0x(?:[0-9A-Fa-f]{2})?([0-9A-Fa-f]{6})\b/g)) {
      const hex = m[1].toUpperCase();
      if (hex === "FFFFFF" || hex === "000000") continue;
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Ganti warna di: .dart (0x[AA]RRGGBB, alpha dipertahankan), pubspec.yaml (#RRGGBB, mis. flutter_native_splash)
 * dan android .../values*\/*.xml (#[AA]RRGGBB).
 */
export function replaceColorInZip(inZip, outZip, oldHex, newHex) {
  const zip = new AdmZip(inZip);
  const oldH = oldHex.toUpperCase();
  const newH = newHex.toUpperCase();
  let total = 0;
  const changedFiles = [];
  for (const entry of zip.getEntries()) {
    if (skip(entry)) continue;
    const lower = lowerName(entry);
    const isDart = lower.endsWith(".dart");
    const isYaml = isPubspec(lower);
    const isXml = lower.includes("/values") && lower.endsWith(".xml");
    if (!isDart && !isYaml && !isXml) continue;
    let content = readText(entry);
    if (!content) continue;
    let count = 0;
    if (isDart) content = content.replace(new RegExp(`0x([0-9A-Fa-f]{2})?${oldH}\\b`, "gi"), (_, a) => (count++, `0x${a || "FF"}${newH}`));
    else if (isYaml) content = content.replace(new RegExp(`#${oldH}\\b`, "gi"), () => (count++, `#${newH}`));
    else content = content.replace(new RegExp(`#([0-9A-Fa-f]{2})?${oldH}\\b`, "gi"), (_, a) => (count++, `#${a || ""}${newH}`));
    if (!count) continue;
    zip.updateFile(entry, Buffer.from(content, "utf8"));
    total += count;
    changedFiles.push({ file: entry.entryName, count });
  }
  if (total) zip.writeZip(outZip);
  return { changedFiles, totalOccurrences: total };
}

export const COLOR_PRESETS = {
  merah: "F44336", biru: "2196F3", hijau: "4CAF50", ungu: "9C27B0", kuning: "FFC107", orange: "FF9800",
  pink: "E91E63", hitam: "212121", putih: "FAFAFA", cyan: "00BCD4", indigo: "3F51B5", teal: "009688",
};
export const isValidHex = (hex) => /^[0-9A-Fa-f]{6}$/.test(hex);

// ─── ICON ────────────────────────────────────────────────────
const ANDROID_ICON_SIZES = { "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192 };
const IOS_ICON_SIZES = {
  "Icon-App-20x20@1x.png": 20, "Icon-App-20x20@2x.png": 40, "Icon-App-20x20@3x.png": 60,
  "Icon-App-29x29@1x.png": 29, "Icon-App-29x29@2x.png": 58, "Icon-App-29x29@3x.png": 87,
  "Icon-App-40x40@1x.png": 40, "Icon-App-40x40@2x.png": 80, "Icon-App-40x40@3x.png": 120,
  "Icon-App-60x60@2x.png": 120, "Icon-App-60x60@3x.png": 180,
  "Icon-App-76x76@1x.png": 76, "Icon-App-76x76@2x.png": 152, "Icon-App-83.5x83.5@2x.png": 167,
  "Icon-App-1024x1024@1x.png": 1024,
};
const ANDROID_ICON_RE = /android\/app\/src\/main\/res\/(mipmap-[a-z]+)\/(ic_launcher(?:_round|_foreground)?\.png)$/;
const IOS_ICON_RE = /ios\/runner\/assets\.xcassets\/appicon\.appiconset\/(.+\.png)$/;

const resize = (buf, size) => sharp(buf).resize(size, size, { fit: "cover" }).png().toBuffer();

/** Lokasi icon yang bisa diganti (kosong = project tidak punya icon standar) */
export function scanIconTargets(zipPath) {
  const zip = new AdmZip(zipPath);
  return zip.getEntries().filter((e) => !e.isDirectory && (ANDROID_ICON_RE.test(lowerName(e)) || IOS_ICON_RE.test(lowerName(e)))).map((e) => e.entryName);
}

/** Ganti semua icon launcher Android & iOS; gambar otomatis di-resize per ukuran slot. Lempar error bila gambar tidak valid. */
export async function replaceIconInZip(inZip, outZip, iconBuffer) {
  await sharp(iconBuffer).metadata(); // validasi gambar (lempar error kalau bukan gambar)
  const zip = new AdmZip(inZip);
  const changedFiles = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const lower = lowerName(entry);
    const a = lower.match(ANDROID_ICON_RE);
    if (a) {
      zip.updateFile(entry, await resize(iconBuffer, ANDROID_ICON_SIZES[a[1]] || 192));
      changedFiles.push(entry.entryName);
      continue;
    }
    if (IOS_ICON_RE.test(lower)) {
      const fileName = entry.entryName.split("/").pop();
      zip.updateFile(entry, await resize(iconBuffer, IOS_ICON_SIZES[fileName] || 192));
      changedFiles.push(entry.entryName);
    }
  }
  if (changedFiles.length) zip.writeZip(outZip);
  return { changedFiles, changedCount: changedFiles.length };
}

// ─── NAMA APLIKASI ───────────────────────────────────────────
/** AndroidManifest android:label, resValue app_name di build.gradle(.kts), strings.xml app_name, iOS Info.plist */
export function replaceAppNameInZip(inZip, outZip, newName) {
  const zip = new AdmZip(inZip);
  const x = xmlEsc(newName);
  const g = gradleEsc(newName);
  let total = 0;
  const changedFiles = [];
  for (const entry of zip.getEntries()) {
    if (skip(entry)) continue;
    const lower = lowerName(entry);
    const isManifest = lower.endsWith("androidmanifest.xml");
    const isGradle = lower.endsWith("build.gradle") || lower.endsWith("build.gradle.kts");
    const isStrings = lower.includes("/values") && lower.endsWith("strings.xml");
    const isPlist = lower.endsWith("info.plist");
    if (!isManifest && !isGradle && !isStrings && !isPlist) continue;
    let content = readText(entry);
    if (!content) continue;
    let count = 0;
    if (isManifest) content = content.replace(/android:label\s*=\s*"([^"]*)"/g, () => (count++, `android:label="${x}"`));
    else if (isGradle) content = content.replace(/resValue\s*\(?\s*"string"\s*,\s*"app_name"\s*,\s*"([^"]*)"\s*\)?/g, () => (count++, `resValue "string", "app_name", "${g}"`));
    else if (isStrings) content = content.replace(/(<string\s+name="app_name">)([^<]*)(<\/string>)/g, (_, a, __, c) => (count++, `${a}${x}${c}`));
    else content = content.replace(/(<key>CFBundle(?:Display)?Name<\/key>\s*<string>)([^<]*)(<\/string>)/g, (_, a, __, c) => (count++, `${a}${x}${c}`));
    if (!count) continue;
    zip.updateFile(entry, Buffer.from(content, "utf8"));
    total += count;
    changedFiles.push({ file: entry.entryName, count });
  }
  if (total) zip.writeZip(outZip);
  return { changedFiles, totalOccurrences: total };
}

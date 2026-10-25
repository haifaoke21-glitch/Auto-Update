import fs from "fs";
import path from "path";
import axios from "axios";
import { loadImage } from "@napi-rs/canvas";

/**
 * Render teks canvas yang aman untuk emoji, simbol, dan semua aksara:
 *  - teks dipecah per grapheme (emoji ZWJ / bendera / skin tone tidak terpotong)
 *  - emoji digambar sebagai gambar Twemoji (di-cache ke data/cache/emoji), jadi tampil
 *    berwarna walau server tidak punya font emoji. Kalau unduhan gagal -> jatuh ke font.
 *  - teks biasa digambar per "run" utuh (bukan per huruf) supaya shaping/ligature tetap benar
 *    dan font fallback (lihat fonts.js) menangani simbol & aksara lain.
 */
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "emoji");
const EMOJI_SCALE = 1.2; // lebar/tinggi emoji relatif terhadap ukuran font
const MAX_EMOJI_FETCH = 40;
const TWEMOJI_URLS = (code) => [
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`,
  `https://raw.githubusercontent.com/jdecked/twemoji/main/assets/72x72/${code}.png`,
];

const segmenter = typeof Intl?.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
export const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(String(s)), (x) => x.segment) : Array.from(String(s)));
export const cut = (s, n) => graphemes(s).slice(0, n).join("");

const KEYCAP = /^[#*0-9]\uFE0F?\u20E3$/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const PICTO = /\p{Extended_Pictographic}/u;

/** Emoji "penuh" (berwarna). Simbol teks biasa seperti ✔ © ★ tetap lewat font. */
export function isEmoji(g) {
  if (KEYCAP.test(g) || FLAG.test(g)) return true;
  if (!PICTO.test(g)) return false;
  return g.codePointAt(0) >= 0x1f000 || g.includes("\uFE0F") || g.includes("\u200D");
}

/** Nama file Twemoji: code point hex dipisah "-", FE0F dibuang kecuali di urutan ZWJ. */
export function emojiCode(g) {
  const cps = Array.from(g, (ch) => ch.codePointAt(0));
  const use = cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f);
  return use.map((c) => c.toString(16)).join("-");
}

/** Pecah string jadi run: teks biasa digabung, setiap emoji berdiri sendiri. */
export function splitRuns(str) {
  const runs = [];
  for (const g of graphemes(str)) {
    if (isEmoji(g)) runs.push({ emoji: true, text: g });
    else if (runs.length && !runs.at(-1).emoji) runs.at(-1).text += g;
    else runs.push({ emoji: false, text: g });
  }
  return runs;
}

export function lineWidth(c, str, px) {
  let w = 0;
  for (const r of splitRuns(str)) w += r.emoji ? px * EMOJI_SCALE : c.measureText(r.text).width;
  return w;
}

/** Potong baris agar muat maxWidth, tambah "…" bila terpotong. */
export function fitLine(c, text, maxWidth, px) {
  if (lineWidth(c, text, px) <= maxWidth) return text;
  const g = graphemes(text);
  while (g.length > 1 && lineWidth(c, g.join("") + "…", px) > maxWidth) g.pop();
  return g.join("") + "…";
}

/** Word-wrap; kata/kalimat tanpa spasi (CJK, Thai, URL panjang, deretan emoji) dipecah per grapheme. */
export function wrap(c, text, maxWidth, px) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      const t = line ? `${line} ${w}` : w;
      if (lineWidth(c, t, px) <= maxWidth) { line = t; continue; }
      if (line) { out.push(line); line = ""; }
      if (lineWidth(c, w, px) <= maxWidth) { line = w; continue; }
      for (const ch of graphemes(w)) {
        const next = line + ch;
        if (lineWidth(c, next, px) > maxWidth && line) { out.push(line); line = ch; } else line = next;
      }
    }
    out.push(line);
  }
  return out;
}

// ---- gambar emoji ----
const images = new Map(); // code -> Image
const inflight = new Map(); // code -> Promise

async function fetchEmoji(code) {
  const file = path.join(CACHE_DIR, `${code}.png`);
  try {
    if (fs.existsSync(file)) return await loadImage(fs.readFileSync(file));
  } catch { /* cache rusak -> unduh ulang */ }
  for (const url of TWEMOJI_URLS(code)) {
    try {
      const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
      const buf = Buffer.from(data);
      const img = await loadImage(buf);
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, buf);
      } catch { /* cache opsional */ }
      return img;
    } catch { /* coba sumber berikutnya */ }
  }
  return null;
}

/** Siapkan gambar semua emoji pada teks sebelum menggambar. */
export async function loadEmojis(...texts) {
  const codes = new Map();
  for (const t of texts) for (const g of graphemes(t || "")) if (isEmoji(g)) codes.set(emojiCode(g), g);
  await Promise.all(
    [...codes.keys()].slice(0, MAX_EMOJI_FETCH).map(async (code) => {
      if (images.has(code)) return;
      if (!inflight.has(code)) inflight.set(code, fetchEmoji(code).finally(() => inflight.delete(code)));
      const img = await inflight.get(code);
      if (img) images.set(code, img);
    })
  );
}

/**
 * Gambar satu baris. align: "left" (x = kiri) atau "center" (x = tengah).
 * baseline: "alphabetic" (default canvas) atau "middle" (y = tengah baris).
 */
export function drawLine(c, str, x, y, px, { align = "left", baseline = "alphabetic" } = {}) {
  const prevAlign = c.textAlign;
  c.textAlign = "left";
  let cx = align === "center" ? x - lineWidth(c, str, px) / 2 : x;
  for (const r of splitRuns(str)) {
    if (r.emoji) {
      const size = px * EMOJI_SCALE;
      const img = images.get(emojiCode(r.text));
      if (img) {
        const top = baseline === "middle" ? y - size / 2 : y - size * 0.78;
        c.drawImage(img, cx, top, size, size);
      } else {
        c.fillText(r.text, cx, y); // fallback ke font (Noto Color Emoji bila ada)
      }
      cx += size;
    } else {
      c.fillText(r.text, cx, y);
      cx += c.measureText(r.text).width;
    }
  }
  c.textAlign = prevAlign;
}

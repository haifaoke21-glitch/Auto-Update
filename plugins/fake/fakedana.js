import sharp from "sharp";
import { getBuffer, escH } from "../../src/lib/util.js";

const MAX_PHOTO = 9.5 * 1024 * 1024; // ~9.5 MB
const MAX_SIDE = 2000; // aman di bawah limit Telegram (hindari PHOTO_INVALID_DIMENSIONS)

/**
 * Pastikan buffer gambar aman dikirim sebagai photo Telegram:
 * - Resize jika terlalu besar dimensinya
 * - Flatten alpha (PNG transparan)
 * - Convert ke JPEG
 * - Compress jika masih terlalu besar file-nya
 */
async function ensureValidPhoto(buf) {
  try {
    const meta = await sharp(buf).metadata();
    const needResize = (meta.width || 0) > MAX_SIDE || (meta.height || 0) > MAX_SIDE;

    let pipeline = sharp(buf).flatten({ background: { r: 255, g: 255, b: 255 } });

    if (needResize) {
      pipeline = pipeline.resize({
        width: meta.width > meta.height ? MAX_SIDE : undefined,
        height: meta.height >= meta.width ? MAX_SIDE : undefined,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    let out = await pipeline.jpeg({ quality: 80, progressive: true, mozjpeg: true }).toBuffer();

    // Kalau masih terlalu besar ukurannya (jarang terjadi setelah resize)
    if (out.length > MAX_PHOTO) {
      out = await sharp(out)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 70, progressive: true })
        .toBuffer();
    }

    return out;
  } catch (err) {
    console.warn("[FAKEDANA] Gagal proses gambar, kirim original:", err.message);
    return buf;
  }
}

export default {
  command: ["fakedana", "fdana"],
  category: "fake",
  description: "Buat fake saldo Dana. Contoh: /fakedana 50000",
  run: async (ctx, { text }) => {
    const nominal = (text || "").replace(/[^\d]/g, "");
    if (!nominal || isNaN(nominal) || Number(nominal) <= 0) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Dana</b>\n\n` +
        `Contoh:\n<code>/fakedana 150000</code>\n` +
        `atau <code>/fakedana 150.000</code>`
      );
    }
    try {
      const url = `https://api.nexray.eu.cc/maker/fakedana?nominal=${encodeURIComponent(nominal)}`;
      const raw = await getBuffer(url);
      const buf = await ensureValidPhoto(raw);
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Dana: <b>Rp ${Number(nominal).toLocaleString("id-ID")}</b>`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Dana: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

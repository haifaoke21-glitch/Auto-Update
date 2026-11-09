import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { initFonts, fontStack, fontListMessage, extractFontOption } from "../../src/lib/fonts.js";
import { cut, wrap, loadEmojis, drawLine } from "../../src/lib/textRender.js";

initFonts();

// Gaya "brat": latar putih, teks hitam (di tengah kalau teks sedikit, rata kiri kalau banyak), blur ringan.
// Mendukung semua font, emoji, simbol & aksara (lihat src/lib/fonts.js dan textRender.js).
export default {
  command: ["brat"],
  category: "canvas",
  description: "Stiker teks gaya brat, semua font, emoji & simbol. Contoh: /brat halo dunia (opsi: font=Nama, /brat fonts)",
  cooldown: 5000,
  run: async (ctx, { text }) => {
    let input = String(text || "").trim();
    if (/^fonts?$/i.test(input)) return ctx.reply(fontListMessage("/brat"));

    const opt = extractFontOption(input, "/brat");
    if (opt.error) return ctx.reply(opt.error);
    input = opt.rest;

    const reply = ctx.message.reply_to_message;
    const body = cut(input || reply?.text || reply?.caption || "", 200);
    if (!body) return ctx.reply("Contoh: /brat halo dunia\nPilih font: /brat font=Poppins halo (daftar: /brat fonts)");

    await loadEmojis(body);

    const size = 512;
    const pad = 36;
    const avail = size - pad * 2;
    const stack = fontStack(opt.family);
    const canvas = createCanvas(size, size);
    const c = canvas.getContext("2d");
    c.fillStyle = "#FFFFFF";
    c.fillRect(0, 0, size, size);
    c.fillStyle = "#000";
    c.textBaseline = "middle";

    // Cari ukuran font terbesar yang masih muat di sticker.
    let fontSize = 120;
    let lines;
    let lineH;
    while (true) {
      c.font = `${fontSize}px ${stack}`;
      lines = wrap(c, body, avail, fontSize);
      lineH = fontSize * 1.15;
      if (lines.length * lineH <= avail || fontSize <= 16) break;
      fontSize -= 4;
    }

    // Teks sedikit (blok teks < 75% area) -> tengah horizontal & vertikal.
    // Teks banyak -> rata kiri dari atas.
    const blockH = lines.length * lineH;
    const centered = blockH < avail * 0.75;
    const top = centered ? (size - blockH) / 2 : pad;
    const x = centered ? size / 2 : pad;

    lines.forEach((l, i) =>
      drawLine(c, l, x, top + lineH * (i + 0.5), fontSize, { align: centered ? "center" : "left", baseline: "middle" })
    );

    const png = canvas.toBuffer("image/png");
    const webp = await sharp(png).blur(0.8).webp({ quality: 90 }).toBuffer();
    await ctx.replyWithSticker({ source: webp });
  },
};

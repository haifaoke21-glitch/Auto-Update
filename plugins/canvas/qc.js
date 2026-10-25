import { createCanvas, loadImage } from "@napi-rs/canvas";
import sharp from "sharp";
import { getBuffer, displayName } from "../../src/lib/util.js";
import { initFonts, fontStack, fontListMessage, extractFontOption } from "../../src/lib/fonts.js";
import { cut, graphemes, wrap, lineWidth, fitLine, loadEmojis, drawLine } from "../../src/lib/textRender.js";

initFonts();

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export default {
  command: ["qc"],
  category: "canvas",
  description: "Buat stiker kutipan chat, semua font, emoji & simbol. Balas pesan dengan /qc (opsi: font=Nama, /qc fonts)",
  cooldown: 6000,
  run: async (ctx, { text }) => {
    let input = String(text || "").trim();
    if (/^fonts?$/i.test(input)) return ctx.reply(fontListMessage("/qc"));

    const opt = extractFontOption(input, "/qc");
    if (opt.error) return ctx.reply(opt.error);
    input = opt.rest;

    const reply = ctx.message.reply_to_message;
    const author = reply?.from || ctx.from;
    const body = cut(reply?.text || reply?.caption || input || "", 400);
    if (!body) return ctx.reply("Balas sebuah pesan teks dengan /qc, atau: /qc <teks>\nPilih font: /qc font=Poppins <teks> (daftar: /qc fonts)");

    const name = displayName(author);
    const stack = fontStack(opt.family);
    const W = 512, avatar = 56, gap = 12, padX = 18, padY = 14;
    const bubbleMax = W - avatar - gap - 40;
    const textMax = bubbleMax - padX * 2;

    await loadEmojis(body, name); // emoji -> gambar (Twemoji), tampil walau server tanpa font emoji

    const measure = createCanvas(10, 10).getContext("2d");
    measure.font = `bold 20px ${stack}`;
    const shownName = fitLine(measure, cut(name, 28), textMax, 20);
    const nameW = lineWidth(measure, shownName, 20);

    measure.font = `22px ${stack}`;
    const lines = wrap(measure, body, textMax, 22);
    const lineH = 28;
    const bubbleH = padY * 2 + 26 + lines.length * lineH;
    const bubbleW = Math.min(bubbleMax, Math.max(...lines.map((l) => lineWidth(measure, l, 22)), nameW) + padX * 2);

    const H = Math.max(bubbleH + 20, avatar + 20);
    const canvas = createCanvas(W, H);
    const c = canvas.getContext("2d");
    // latar transparan agar jadi stiker bersih

    // avatar
    let img = null;
    try {
      const photos = await ctx.telegram.getUserProfilePhotos(author.id, 0, 1);
      if (photos.total_count) {
        const link = await ctx.telegram.getFileLink(photos.photos[0][0].file_id);
        img = await loadImage(await getBuffer(link.href));
      }
    } catch { /* tanpa avatar */ }
    c.save();
    c.beginPath();
    c.arc(20 + avatar / 2, 10 + avatar / 2, avatar / 2, 0, Math.PI * 2);
    c.clip();
    if (img) c.drawImage(img, 20, 10, avatar, avatar);
    else {
      c.fillStyle = "#7c6ff0";
      c.fillRect(20, 10, avatar, avatar);
      c.fillStyle = "#fff";
      c.font = `30px ${stack}`;
      drawLine(c, (graphemes(name)[0] || "?").toUpperCase(), 20 + avatar / 2, 10 + avatar / 2 + 11, 30, { align: "center" });
    }
    c.restore();

    // bubble
    const bx = 20 + avatar + gap;
    c.fillStyle = "#1f2937";
    roundRect(c, bx, 10, bubbleW, bubbleH, 18);
    c.fill();
    c.fillStyle = "#93c5fd";
    c.font = `bold 20px ${stack}`;
    drawLine(c, shownName, bx + padX, 10 + padY + 18, 20);
    c.fillStyle = "#f9fafb";
    c.font = `22px ${stack}`;
    lines.forEach((l, i) => drawLine(c, l, bx + padX, 10 + padY + 26 + 22 + i * lineH, 22));

    const webp = await sharp(canvas.toBuffer("image/png")).resize({ width: 512, fit: "inside" }).webp({ quality: 92 }).toBuffer();
    await ctx.replyWithSticker({ source: webp });
  },
};

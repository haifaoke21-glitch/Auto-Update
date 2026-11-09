import { createCanvas } from "@napi-rs/canvas";

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

export default {
  command: ["kalender"],
  category: "canvas",
  description: "Gambar kalender. Contoh: /kalender  atau /kalender 12 2026",
  cooldown: 5000,
  run: async (ctx, { args }) => {
    const now = new Date();
    let month = parseInt(args[0]) || now.getMonth() + 1;
    let year = parseInt(args[1]) || now.getFullYear();
    if (month < 1 || month > 12 || year < 1900 || year > 2200) return ctx.reply("Contoh: /kalender 12 2026");

    const W = 700, H = 620;
    const canvas = createCanvas(W, H);
    const c = canvas.getContext("2d");
    c.fillStyle = "#0f172a"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#38bdf8"; c.fillRect(0, 0, W, 96);
    c.fillStyle = "#0f172a"; c.font = "bold 40px sans-serif"; c.textAlign = "center";
    c.fillText(`${BULAN[month - 1]} ${year}`, W / 2, 62);

    const cw = W / 7;
    c.font = "bold 22px sans-serif";
    HARI.forEach((h, i) => { c.fillStyle = i === 0 ? "#f87171" : "#94a3b8"; c.fillText(h, cw * i + cw / 2, 140); });

    const first = new Date(year, month - 1, 1).getDay();
    const days = new Date(year, month, 0).getDate();
    const today = now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : -1;
    c.font = "26px sans-serif";
    for (let d = 1; d <= days; d++) {
      const idx = first + d - 1;
      const col = idx % 7, row = Math.floor(idx / 7);
      const x = cw * col + cw / 2, y = 200 + row * 76;
      if (d === today) {
        c.fillStyle = "#38bdf8"; c.beginPath(); c.arc(x, y - 9, 28, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#0f172a";
      } else c.fillStyle = col === 0 ? "#f87171" : "#e2e8f0";
      c.fillText(String(d), x, y);
    }
    await ctx.replyWithPhoto({ source: canvas.toBuffer("image/png") });
  },
};

import axios from "axios";
import { escH } from "../../src/lib/util.js";

const API = "https://api.deline.web.id/maker/iqc";

const pad = (n) => String(n).padStart(2, "0");
const nowWIB = () => {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // WIB (UTC+7)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const validTime = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);

// Ambil gambar dari respons API: bisa langsung gambar, atau JSON berisi URL.
async function fetchIqc(params) {
  const res = await axios.get(API, {
    params,
    responseType: "arraybuffer",
    timeout: 60000,
    headers: { "User-Agent": "Mozilla/5.0" },
    validateStatus: () => true,
  });
  const type = String(res.headers["content-type"] || "");
  const buf = Buffer.from(res.data);

  if (type.startsWith("image/")) return buf;

  let json;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* bukan JSON */ }
  if (!json) throw new Error(`Respons API tidak dikenali (HTTP ${res.status})`);

  const url =
    json.result?.url || json.result?.image || json.data?.url || json.url ||
    (typeof json.result === "string" ? json.result : null) ||
    (typeof json.data === "string" ? json.data : null);
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(json.message || json.error || json.msg || `API gagal (HTTP ${res.status})`);
  }
  const img = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  return Buffer.from(img.data);
}

export default {
  command: ["iqc"],
  category: "canvas",
  description: "Buat screenshot chat iPhone palsu. Contoh: /iqc halo dunia  |  /iqc halo | 12:30 | 12:31",
  cooldown: 8000,
  run: async (ctx, { text }) => {
    let input = String(text || "").trim();
    const reply = ctx.message.reply_to_message;
    if (!input) input = String(reply?.text || reply?.caption || "").trim();

    if (!input) {
      return ctx.reply(
        "Contoh:\n/iqc halo dunia\n/iqc halo dunia | 12:30 | 12:31\n\n" +
        "Format: /iqc <teks> | <jam status bar> | <jam chat>\n" +
        "Jam opsional (default: jam sekarang WIB). Bisa juga balas pesan teks dengan /iqc."
      );
    }

    // Pisah "teks | statusBarTime | chatTime" kalau dua segmen terakhir berupa jam valid
    const parts = input.split("|").map((s) => s.trim());
    let statusBarTime = nowWIB();
    let chatTime = statusBarTime;
    if (parts.length >= 2 && validTime(parts.at(-1))) {
      if (parts.length >= 3 && validTime(parts.at(-2))) {
        chatTime = parts.pop();
        statusBarTime = parts.pop();
      } else {
        statusBarTime = chatTime = parts.pop();
      }
      input = parts.join("|").trim();
    }

    if (!input) return ctx.reply("Teksnya kosong. Contoh: /iqc halo dunia");
    if (input.length > 500) input = input.slice(0, 500);

    ctx.sendChatAction("upload_photo").catch(() => {});
    try {
      const buffer = await fetchIqc({ text: input, chatTime, statusBarTime });
      await ctx.replyWithPhoto({ source: buffer });
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal membuat IQC: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};

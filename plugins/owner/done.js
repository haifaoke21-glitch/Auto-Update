import { sendRichBlocks } from "../../src/lib/richSend.js";
import { h } from "../../src/lib/rich.js";
import moment from "moment-timezone";

const usage = (p) =>
  `<tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> <b>Cara pakai ${h(p)}done</b>\n\n` +
  `<pre>${h(p)}done produk | jumlah | total | payment | owner_link | channel_link | cs_link</pre>\n\n` +
  `Contoh:\n<code>${h(p)}done Sc ubot full up | 1× | Rp 20.000 | Qris all payment | https://t.me/owner | https://t.me/channel | https://t.me/cs</code>\n\n` +
  `• Balas sebuah <b>foto</b> dengan perintah ini untuk menempelkan foto di atas Rich Message.\n` +
  `• ID Transaksi & Waktu diisi otomatis.\n` +
  `• Link tombol opsional.\n` +
  `• Separator: <code>|</code>`;

function nextId() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return "#" + String(n).padStart(4, "0");
}

function normLink(raw) {
  if (!raw) return "";
  const s = raw.trim();
  if (s.startsWith("http") || s.startsWith("tg:")) return s;
  if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
  if (s.startsWith("t.me/")) return `https://${s}`;
  return s.includes(".") ? `https://${s}` : `https://t.me/${s}`;
}

export default {
  command: ["done", "trx", "testi"],
  category: "owner",
  description: "Buat pesan Transaksi Berhasil / Testi Rich Message (balas foto = tambah foto). Contoh: /done produk | jumlah | total | payment",
  ownerOnly: true,
  cooldown: 5000,
  run: async (ctx, { text }) => {
    const raw = (text || "").trim();
    if (!raw) return ctx.reply(usage("/"), { parse_mode: "HTML" });

    const parts = raw.split("|").map((s) => s.trim());
    const produk = parts[0] || "Produk";
    const jumlah = parts[1] || "1×";
    const total = parts[2] || "Rp 0";
    const payment = parts[3] || "QRIS";
    const ownerLink = normLink(parts[4]);
    const channelLink = normLink(parts[5]);
    const csLink = normLink(parts[6]);

    const trxId = nextId();
    const waktu = moment().tz("Asia/Jakarta").format("HH:mm") + " WIB";

    const msg = ctx.message;
    let photoId = msg.photo?.at(-1)?.file_id || null;
    const reply = msg.reply_to_message;
    if (!photoId && reply) photoId = reply.photo?.at(-1)?.file_id || null;

    const cell = (text, extra = {}) => ({ text, align: "left", valign: "middle", ...extra });
    const head = (text) => cell(text, { is_header: true, align: "center" });

    // Marker {ID|emoji} -> otomatis jadi <tg-emoji> kalau owner premium, emoji biasa kalau tidak
    const blocks = [
      { type: "heading", text: "{6206185428702206246|✅} Transaksi Berhasil" },
      { type: "paragraph", text: "Kami informasikan bahwa transaksi Anda telah berhasil diproses. Detail lengkap mengenai transaksi Anda dapat dilihat pada tabel di bawah ini." },
      { type: "divider" },
      {
        type: "table",
        is_bordered: true,
        is_striped: true,
        cells: [
          [head("Aspek"), head("Detail")],
          [cell("{6206190608432764318|📌} ID Transaksi"), cell(trxId)],
          [cell("{5341715473882955310|⚙️} Produk"), cell(produk)],
          [cell("{6206343625232619150|📊} Jumlah"), cell(jumlah)],
          [cell("{6190336264940559752|💰} Total"), cell(total)],
          [cell("{6206155797722830770|💵} Payment"), cell(payment)],
          [cell("{6098230596788556786|🕐} Waktu"), cell(waktu)],
          [cell("{6206185428702206246|✅} Status"), cell("Berhasil / Selesai")],
        ],
      },
      { type: "paragraph", text: "{6206220960966646470|💎} Terima kasih telah melakukan pembelian." },
    ];

    const buttons = [];
    if (ownerLink) buttons.push({ text: "Owner", url: ownerLink, style: "success" });
    if (channelLink) buttons.push({ text: "Channel", url: channelLink, style: "primary" });
    if (csLink) buttons.push({ text: "Customer Service", url: csLink, style: "success" });

    if (buttons.length) {
      blocks.push({ type: "buttons", buttons, align: "center" });
    }

    blocks.push({
      type: "details",
      summary: "{5816948361030275678|💡} Detail Lanjutan",
      blocks: [
        { type: "paragraph", text: "{6307777408300753473|👤} Hubungi Customer Service jika ada kendala." },
      ],
    });

    try {
      await sendRichBlocks(ctx, blocks, photoId);
    } catch (err) {
      console.error("[DONE]", err);
      await ctx.reply(`⚠️ Gagal membuat Rich Message.\n<code>${h(err.message)}</code>`, { parse_mode: "HTML" }).catch(() => {});
    }
  },
};

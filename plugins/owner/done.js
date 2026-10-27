import { sendRichBlocks } from "../../src/lib/richSend.js";
import { h } from "../../src/lib/rich.js";
import moment from "moment-timezone";

const usage = (p) =>
  `<tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> <b>Cara pakai ${h(p)}done</b>\n\n` +
  `<pre>${h(p)}done produk | jumlah | total | payment | owner_link | channel_link | cs_link</pre>\n\n` +
  `Contoh:\n<code>${h(p)}done Sc ubot full up | 1× | Rp 20.000 | Qris all payment | https://t.me/owner | https://t.me/channel | https://t.me/cs</code>\n\n` +
  `• Balas sebuah <b>foto</b> dengan perintah ini untuk menempelkan foto di atas Rich Message.\n` +
  `• ID Transaksi & Waktu diisi otomatis.\n` +
  `• Link tombol opsional (boleh dikosongkan).\n` +
  `• Separator: <code>|</code>`;

function nextId() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return "#" + String(n).padStart(4, "0");
}

export default {
  command: ["done", "trx", "testi"],
  category: "owner",
  description: "Buat pesan Transaksi Berhasil / Testi seperti Rich Message (balas foto = tambah foto). Contoh: /done produk | jumlah | total | payment",
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
    const ownerLink = parts[4] || "";
    const channelLink = parts[5] || "";
    const csLink = parts[6] || "";

    const trxId = nextId();
    const waktu = moment().tz("Asia/Jakarta").format("HH:mm") + " WIB";

    // Foto opsional via reply
    const msg = ctx.message;
    let photoId = msg.photo?.at(-1)?.file_id || null;
    const reply = msg.reply_to_message;
    if (!photoId && reply) {
      photoId = reply.photo?.at(-1)?.file_id || null;
    }

    // Bangun Rich Message blocks
    const blocks = [
      { type: "heading", text: "✅ Transaksi Berhasil" },
      { type: "paragraph", text: "Kami informasikan bahwa transaksi Anda telah berhasil diproses. Detail lengkap mengenai transaksi Anda dapat dilihat pada tabel di bawah ini." },
      { type: "divider" },
      {
        type: "table",
        is_bordered: true,
        is_striped: true,
        cells: [
          [
            { text: "Aspek", is_header: true, align: "center", valign: "middle" },
            { text: "Detail", is_header: true, align: "center", valign: "middle" },
          ],
          [
            { text: "📌 ID Transaksi", align: "left", valign: "middle" },
            { text: trxId, align: "left", valign: "middle" },
          ],
          [
            { text: "⚙️ Produk", align: "left", valign: "middle" },
            { text: produk, align: "left", valign: "middle" },
          ],
          [
            { text: "📊 Jumlah", align: "left", valign: "middle" },
            { text: jumlah, align: "left", valign: "middle" },
          ],
          [
            { text: "💰 Total", align: "left", valign: "middle" },
            { text: total, align: "left", valign: "middle" },
          ],
          [
            { text: "💵 Payment", align: "left", valign: "middle" },
            { text: payment, align: "left", valign: "middle" },
          ],
          [
            { text: "🕒 Waktu", align: "left", valign: "middle" },
            { text: waktu, align: "left", valign: "middle" },
          ],
          [
            { text: "✅ Status", align: "left", valign: "middle" },
            { text: "Berhasil / Selesai", align: "left", valign: "middle" },
          ],
        ],
      },
      { type: "paragraph", text: "💎 Terima kasih telah melakukan pembelian." },
    ];

    // Expandable detail lanjutan + tombol
    const detailBlocks = [];
    const buttons = [];
    if (ownerLink) buttons.push({ text: "Owner", url: ownerLink.startsWith("http") || ownerLink.startsWith("tg:") || ownerLink.startsWith("t.me") || ownerLink.startsWith("@") ? (ownerLink.startsWith("@") ? `https://t.me/${ownerLink.slice(1)}` : ownerLink) : `https://${ownerLink}`, style: "success" });
    if (channelLink) buttons.push({ text: "Channel", url: channelLink.startsWith("http") || channelLink.startsWith("tg:") || channelLink.startsWith("t.me") || channelLink.startsWith("@") ? (channelLink.startsWith("@") ? `https://t.me/${channelLink.slice(1)}` : channelLink) : `https://${channelLink}`, style: "primary" });
    if (csLink) buttons.push({ text: "Customer Service", url: csLink.startsWith("http") || csLink.startsWith("tg:") || csLink.startsWith("t.me") || csLink.startsWith("@") ? (csLink.startsWith("@") ? `https://t.me/${csLink.slice(1)}` : csLink) : `https://${csLink}`, style: "success" });

    if (buttons.length) {
      detailBlocks.push({ type: "buttons", buttons });
    }
    detailBlocks.push({ type: "paragraph", text: "👤 Hubungi Customer Service jika ada kendala." });

    if (detailBlocks.length) {
      blocks.push({
        type: "details",
        summary: [{ type: "bold", text: "💡 Detail Lanjutan" }],
        blocks: detailBlocks,
      });
    }

    try {
      await sendRichBlocks(ctx, blocks, photoId);
    } catch (err) {
      console.error("[DONE]", err);
      await ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal membuat Rich Message transaksi.\n<code>${h(err.message)}</code>`, { parse_mode: "HTML" }).catch(() => {});
    }
  },
};

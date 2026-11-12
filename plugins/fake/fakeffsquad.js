import { getBuffer, escH } from "../../src/lib/util.js";
import { registerCallback } from "../../src/lib/callbacks.js";

// Simpan data sementara untuk pemilihan template
const pending = new Map(); // token -> { names: string[], uid: number, timer }
const TTL = 5 * 60 * 1000; // 5 menit

function newToken() {
  return Math.random().toString(36).slice(2, 8);
}

function clearPending(token) {
  const st = pending.get(token);
  if (st?.timer) clearTimeout(st.timer);
  pending.delete(token);
}

// Bangun keyboard template 1-9
function templateKeyboard(token, nameCount) {
  const rows = [];
  // Template 1-8 = 4 pemain, 9 = 5 pemain
  const available = nameCount >= 5 ? [1,2,3,4,5,6,7,8,9] : [1,2,3,4,5,6,7,8];
  for (let i = 0; i < available.length; i += 5) {
    const slice = available.slice(i, i + 5);
    rows.push(slice.map(n => ({
      text: `Template ${n}`,
      callback_data: `ffsq:${token}:${n}`,
    })));
  }
  rows.push([{ text: "❌ Batal", callback_data: `ffsq:${token}:x` }]);
  return { inline_keyboard: rows };
}

export default {
  command: ["fakeffsquad"],
  category: "fake",
  description: "Buat fake lobby squad Free Fire Max. Wajib pilih template via tombol.",
  run: async (ctx, { text }) => {
    const raw = (text || "").trim();
    if (!raw) {
      return ctx.replyWithHTML(
        `🎮 <b>Fake FF Squad</b>\n\n` +
        `Bikin lobi squad Free Fire Max palsu.\n` +
        `Masukkan nama pemain (pisahkan dengan <code>|</code>), lalu pilih template lewat tombol.\n\n` +
        `Template 1-8 = 4 pemain, template 9 = 5 pemain.\n\n` +
        `Contoh:\n<code>/fakeffsquad Nama1 | Nama2 | Nama3 | Nama4 | Name5</code>`
      );
    }

    const names = raw.split(/[|]/).map(s => s.trim()).filter(Boolean);
    if (names.length < 1) {
      return ctx.reply("Masukkan minimal satu nama pemain.\nContoh: /fakeffsquad A | B | C | D");
    }
    if (names.length > 5) {
      return ctx.reply("Maksimal 5 nama pemain.");
    }

    const token = newToken();
    const uid = ctx.from.id;
    const timer = setTimeout(() => clearPending(token), TTL);
    pending.set(token, { names, uid, timer });

    const namesDisplay = names.map(n => escH(n)).join(" | ");
    await ctx.replyWithHTML(
      `🎮 <b>Fake FF Squad</b>\n\n` +
      `Pemain: <b>${namesDisplay}</b>\n` +
      `(${names.length} pemain)\n\n` +
      `Pilih template di bawah:\n` +
      `<i>Template 1-8 = 4 pemain • Template 9 = 5 pemain</i>`,
      { reply_markup: templateKeyboard(token, names.length) }
    );
  },
};

// Handler tombol template
registerCallback("ffsq", async (ctx, args) => {
  const [token, tmplStr] = args;
  const st = pending.get(token);
  if (!st) {
    return ctx.answerCbQuery("Sesi sudah kedaluwarsa. Kirim ulang perintah.", { show_alert: true });
  }
  if (ctx.from.id !== st.uid) {
    return ctx.answerCbQuery("Tombol ini bukan milik kamu.", { show_alert: true });
  }

  if (tmplStr === "x") {
    clearPending(token);
    await ctx.answerCbQuery("Dibatalkan");
    try { await ctx.editMessageText("❌ Dibatalkan."); } catch {}
    return;
  }

  const template = Number(tmplStr);
  if (!template || template < 1 || template > 9) {
    return ctx.answerCbQuery("Template tidak valid", { show_alert: true });
  }
  // Validasi jumlah nama vs template
  if (template === 9 && st.names.length < 5) {
    return ctx.answerCbQuery("Template 9 butuh 5 nama pemain.", { show_alert: true });
  }
  if (template <= 8 && st.names.length < 4) {
    // Boleh, API akan handle, tapi beri peringatan ringan
  }

  clearPending(token);
  await ctx.answerCbQuery(`Memproses template ${template}...`);

  try {
    const params = new URLSearchParams({
      names: st.names.join("|"),
      template: String(template),
    });
    const apiUrl = `https://api-cloud.my.id/maker/fakeffsquad?${params.toString()}`;
    const buf = await getBuffer(apiUrl);
    if (!buf || buf.length < 100) {
      throw new Error("Gambar kosong atau gagal di-generate");
    }
    const namesDisplay = st.names.map(n => escH(n)).join(", ");
    await ctx.replyWithPhoto({ source: buf }, {
      caption: `✅ Fake FF Squad (template ${template})\nPemain: <b>${namesDisplay}</b>`,
      parse_mode: "HTML",
    });
    // Hapus pesan pilihan template
    try { await ctx.deleteMessage(); } catch {}
  } catch (err) {
    await ctx.reply(`❌ Gagal membuat fake FF Squad: ${escH(err.message)}`, { parse_mode: "HTML" });
  }
});

import axios from "axios";
import { registerCallback } from "../../src/lib/callbacks.js";
import { formatBytes, escH } from "../../src/lib/util.js";

const TTL = 10 * 60 * 1000; // sesi pilih host kadaluarsa setelah 10 menit
const MAX_BYTES = 20 * 1024 * 1024; // batas getFile Bot API Telegram (20MB)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Catbox & Uguu diunggah LANGSUNG (tanpa perantara API pihak ketiga) supaya tidak kena 403.
const HOSTS = {
  catbox: {
    label: "📦 Catbox",
    upload: async (buf, name) => {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      // Opsional: isi CATBOX_USERHASH di .env supaya upload lewat akun Catbox (lebih jarang diblokir)
      if (process.env.CATBOX_USERHASH) form.append("userhash", process.env.CATBOX_USERHASH);
      form.append("fileToUpload", new Blob([buf]), name);
      // Catbox menolak UA browser palsu ("Invalid uploader"), jadi pakai UA sederhana
      const { data } = await axios.post("https://catbox.moe/user/api.php", form, reqOpts("curl/8.5.0"));
      const url = typeof data === "string" ? data.trim() : "";
      if (!/^https?:\/\//.test(url)) throw new Error(url || "Catbox tidak mengembalikan URL");
      return url;
    },
  },
  uguu: {
    label: "💧 Uguu",
    upload: async (buf, name) => {
      const form = new FormData();
      form.append("files[]", new Blob([buf]), name);
      const { data } = await axios.post("https://uguu.se/upload?output=json", form, reqOpts());
      const url = data?.files?.[0]?.url;
      if (!url) throw new Error(data?.description || "Uguu tidak mengembalikan URL");
      return url;
    },
  },
};

function reqOpts(ua = UA) {
  return {
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: { "User-Agent": ua },
  };
}

/** Ubah error axios jadi pesan yang jelas (status + potongan isi respons) */
function describeError(err) {
  const r = err.response;
  if (!r) return err.message;
  let body = typeof r.data === "string" ? r.data : r.data?.error || r.data?.message || JSON.stringify(r.data ?? "");
  body = String(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return `HTTP ${r.status}${body ? ` - ${body}` : ""}`;
}

// Cache sesi: `${chatId}:${promptMessageId}` -> { userId, fileId, at }
// Dikunci per pesan pilihan host (bukan per user), jadi beberapa /tourl berurutan tidak saling menimpa.
const sessions = new Map();
const key = (ctx) => `${ctx.chat.id}:${ctx.callbackQuery.message.message_id}`;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.at > TTL) sessions.delete(k);
}, 60 * 1000).unref();

/** Ambil file_id dari sebuah pesan (foto, video, dokumen, audio, dll) */
function extractFile(msg) {
  if (!msg) return null;
  if (msg.photo?.length) return { id: msg.photo.at(-1).file_id, size: msg.photo.at(-1).file_size };
  const f = msg.video || msg.document || msg.audio || msg.voice || msg.animation || msg.video_note || msg.sticker;
  return f ? { id: f.file_id, size: f.file_size, name: f.file_name } : null;
}

registerCallback("tourl", async (ctx, [host]) => {
  const cfg = HOSTS[host];
  const k = key(ctx);
  const session = sessions.get(k);

  if (!cfg) return ctx.answerCbQuery();
  if (!session || Date.now() - session.at > TTL) {
    sessions.delete(k);
    return ctx.answerCbQuery("❌ Sesi kadaluarsa! Kirim ulang /tourl.", { show_alert: true });
  }
  if (session.userId !== ctx.from.id) {
    return ctx.answerCbQuery("Ini bukan permintaan kamu!", { show_alert: true });
  }
  if (session.busy) return ctx.answerCbQuery("Sedang diunggah, tunggu sebentar...");

  session.busy = true;
  try {
    await ctx.answerCbQuery(`Mengunggah ke ${host}...`);
    await ctx.editMessageText(`<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Memproses file untuk <b>${escH(host.toUpperCase())}</b>...`, { parse_mode: "HTML" });

    const link = await ctx.telegram.getFileLink(session.fileId);
    const res = await axios.get(link.href, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
    }).catch((err) => {
      if (/maxContentLength|maxBodyLength/i.test(err?.message || "")) throw new Error(`File terlalu besar (maks ${Math.round(MAX_BYTES / 1024 / 1024)}MB, batas Telegram untuk bot mengunduh file).`);
      throw err;
    });
    const fileName = link.href.split("/").pop();

    const finalUrl = await cfg.upload(res.data, fileName);

    sessions.delete(k);
    return await ctx.editMessageText(
      `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> <b>Berhasil Diupload!</b>\n\n<tg-emoji emoji-id="5447410659077661506">🌐</tg-emoji> <b>Host:</b> ${escH(host.toUpperCase())}\n<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>URL:</b> <code>${escH(finalUrl)}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Buka Link", url: finalUrl }]] },
      }
    );
  } catch (err) {
    console.error("[TOURL]", err.message);
    session.busy = false;
    const errMsg = describeError(err);
    // Sesi dipertahankan supaya user bisa coba host lain tanpa kirim ulang /tourl
    return ctx.editMessageText(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal (${escH(host)}): ${escH(errMsg)}\n\nCoba host lain:`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: hostKeyboard() },
    }).catch(() => {});
  }
});

function hostKeyboard() {
  return [
    [
      { text: HOSTS.catbox.label, callback_data: "tourl:catbox" },
      { text: HOSTS.uguu.label, callback_data: "tourl:uguu" },
    ],
  ];
}

export default {
  command: ["tourl"],
  category: "utility",
  loading: false,
  description: "Upload foto/video/file jadi link. Reply media dengan /tourl lalu pilih host",
  cooldown: 5000,
  run: async (ctx) => {
    // Media bisa dari reply, atau dari pesan itu sendiri (command di caption)
    const file = extractFile(ctx.message.reply_to_message) || extractFile(ctx.message);
    if (!file) {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Silakan reply foto/video/file dengan command /tourl", {
        parse_mode: "HTML",
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      });
    }
    if (file.size && file.size > MAX_BYTES) {
      return ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> File terlalu besar (${escH(formatBytes(file.size))}). Batas bot Telegram 20 MB.`, { parse_mode: "HTML" });
    }

    const sent = await ctx.reply("<tg-emoji emoji-id=\"5447410659077661506\">🌐</tg-emoji> <b>Pilih Host Upload:</b>", {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: hostKeyboard() },
    });
    sessions.set(`${ctx.chat.id}:${sent.message_id}`, { userId: ctx.from.id, fileId: file.id, at: Date.now() });
  },
};

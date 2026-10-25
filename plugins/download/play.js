import axios from "axios";
import config from "../../config.js";
import { isUrl, escH } from "../../src/lib/util.js";
import { uploadForFileId } from "../../src/lib/scratch.js";
import { maxBotApiUploadBytes, isTooLargeErr } from "../../src/lib/net.js";

const DEFAULT_API = "https://api.ikyyxd.my.id/search/ytplayv2";

const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDur = (sec = 0) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Cari lagu dari JUDUL. Respons yang dikenali: { status, result: { title, duration, thumbnail, source, audio: { url } } } */
async function searchSong(query) {
  const { data } = await axios.get(config.playApi || DEFAULT_API, { params: { q: query }, timeout: 30000 });
  const r = data?.result;
  if (!data?.status || !r) throw new Error("Lagu tidak ditemukan (judul salah / format API berubah).");
  const audioUrl = r.audio?.url || (typeof r.audio === "string" ? r.audio : null);
  if (!audioUrl) throw new Error("API tidak mengembalikan link audio.");
  return {
    title: r.title || query,
    duration: Number(r.duration) || 0,
    thumbnail: r.thumbnail || null,
    source: r.source || "",
    audioUrl,
  };
}

async function download(url, maxBytes = maxBotApiUploadBytes()) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    return Buffer.from(res.data);
  } catch (err) {
    if (isTooLargeErr(err)) {
      const e = new Error(`File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)}MB).`);
      e.code = "TOO_LARGE";
      throw e;
    }
    throw err;
  }
}

/** Thumbnail audio Telegram: JPEG, maks 320px & 200KB. sharp sudah ada di dependencies */
async function toThumb(buf) {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(buf).resize(320, 320, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

/** Kartu Rich Message: cover + tabel info + blok audio asli (Bot API 10.2+). Return true bila terkirim */
async function sendRichCard(ctx, song, audioBuffer, coverBuffer, thumb) {
  const audioId = await uploadForFileId(ctx, "audio", { source: audioBuffer, filename: "audio.mp3" }, {
    title: song.title, performer: song.source || undefined, duration: song.duration || undefined,
    ...(thumb ? { thumbnail: { source: thumb } } : {}),
  });
  if (!audioId) return false;
  const coverId = coverBuffer ? await uploadForFileId(ctx, "photo", { source: coverBuffer }) : null;

  const media = [];
  let html = "";
  if (coverId) {
    media.push({ id: "cover", media: { type: "photo", media: coverId } });
    html += `<img src="tg://photo?id=cover"/>`;
  }
  html +=
    `<table bordered striped><tr><th><tg-emoji emoji-id="5463107823946717464">🎵</tg-emoji> PLAY</th><th>INFO</th></tr>` +
    `<tr><td>Judul</td><td>${h(song.title)}</td></tr>` +
    `<tr><td>Durasi</td><td>${fmtDur(song.duration)}</td></tr>` +
    (song.source ? `<tr><td>Sumber</td><td>${h(song.source)}</td></tr>` : "") +
    `</table>` +
    `<audio src="tg://audio?id=song"></audio>`;
  media.push({ id: "song", media: { type: "audio", media: audioId, title: song.title, performer: song.source || undefined, duration: song.duration || undefined } });

  const extra = ctx.message?.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
  await ctx.telegram.callApi("sendRichMessage", {
    chat_id: ctx.chat.id,
    rich_message: { html, media },
    reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    ...extra,
  });
  return true;
}

export default {
  command: ["play"],
  category: "download",
  loading: false, // sudah punya pesan tunggu sendiri
  description: "Cari & download lagu YouTube dari judul. Contoh: /play penjaga hati",
  cooldown: 15000,
  run: async (ctx, { text }) => {
    const query = (text || "").trim();
    if (!query) return ctx.reply("Contoh: /play penjaga hati\nCukup tulis judul lagunya (bukan link).");
    if (isUrl(query)) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> /play memakai judul lagu, bukan link. Untuk link YouTube gunakan /ytmp3 &lt;url&gt;.", { parse_mode: "HTML" });

    const wait = await ctx.reply("<tg-emoji emoji-id=\"5231012545799666522\">🔎</tg-emoji> Mencari lagu...", { parse_mode: "HTML" });
    try {
      const song = await searchSong(query);
      let audioBuffer;
      try {
        audioBuffer = await download(song.audioUrl);
      } catch (err) {
        if (err.code !== "TOO_LARGE") throw err;
        // Terlalu besar untuk diupload bot -> kirim info + tombol link download langsung
        await ctx.reply(
          `<tg-emoji emoji-id="5463107823946717464">🎵</tg-emoji> <b>${h(song.title)}</b>\n<tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> ${fmtDur(song.duration)}\n\n<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> Audionya terlalu besar untuk dikirim bot Telegram (mix/durasi panjang), jadi kuberikan link unduhan langsung.`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Download Audio", icon_custom_emoji_id: "5431721976769027887", emoji_fallback: "⬇️", url: song.audioUrl }]] } }
        );
        return;
      }
      let coverBuffer = null;
      if (song.thumbnail) coverBuffer = await download(song.thumbnail, 10 * 1024 * 1024).catch(() => null);
      const thumb = coverBuffer ? await toThumb(coverBuffer) : null;

      // 1) Rich Message (cover + info + blok audio). Gagal -> lanjut ke pesan audio biasa
      try {
        if (await sendRichCard(ctx, song, audioBuffer, coverBuffer, thumb)) return;
      } catch (err) {
        console.warn("[PLAY] Rich Message gagal, kirim audio biasa:", err?.message);
      }

      // 2) Fallback: 1 pesan audio + cover sebagai thumbnail
      const caption = `<tg-emoji emoji-id="5463107823946717464">🎵</tg-emoji> <b>${h(song.title)}</b>\n<tg-emoji emoji-id="5969545478155539601">⏱️</tg-emoji> ${fmtDur(song.duration)}` + (song.source ? `\n🔗 ${h(song.source)}` : "");
      const file = { source: audioBuffer, filename: `${song.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "audio"}.mp3` };
      const opts = { caption, parse_mode: "HTML", title: song.title, performer: song.source || undefined, duration: song.duration || undefined };
      try {
        await ctx.replyWithAudio(file, thumb ? { ...opts, thumbnail: { source: thumb } } : opts);
      } catch (err) {
        if (!thumb) throw err;
        await ctx.replyWithAudio(file, opts); // thumbnail ditolak -> kirim tanpa cover
      }
    } catch (err) {
      await ctx.reply(`<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: ${escH(err.message)}`, { parse_mode: "HTML" });
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════
// TEXTMATCH — fitur canvas /textmatch (API: https://api-cloud.my.id/maker/textmatch)
//
// Alur:
//   1) /textmatch            -> bot minta user mengirim teks (Rich Message + tombol Batal)
//   2) user kirim teks       -> bot menampilkan Rich Message pengaturan dengan tombol Ratio & Sound
//   3) tekan tombol Buat     -> bot memanggil API lalu mengirim hasilnya (gambar / video / audio)
//   (/textmatch <teks> langsung melompat ke langkah 2)
//
// Semua pesan memakai Rich Message (richUi.js) & tombol berwarna animasi seperti fitur lain.
// Pengaturan ada di konstanta SETTINGS di bawah (tidak perlu mengubah config.js).
// ═══════════════════════════════════════════════════════════════════════
import axios from "axios";
import config from "../../config.js";
import { registerCallback } from "./callbacks.js";
import { title, quote, note, table, h, replyView, editCbView, dropAnim } from "./richUi.js";
import { escH } from "./util.js";

// ── PENGATURAN (ubah di sini) ───────────────────────────────────────────
const SETTINGS = {
  apiUrl: "https://api-cloud.my.id/maker/textmatch",
  apiKey: "", // dikirim sebagai ?apikey= bila diisi
  ratios: ["1:1", "9:16", "16:9"], // tombol ratio yang tampil
  defaultRatio: "9:16",
  defaultSound: true,
};
const TTL = 3 * 60 * 1000;
const MAX_TEXT = 200;

// kode callback (tanpa ":") -> nilai ratio yang dikirim ke API
const DEFAULT_RATIOS = { "1x1": "1:1", "9x16": "9:16", "16x9": "16:9" };
const cfg = () => SETTINGS;
const ratios = () => {
  const r = cfg().ratios;
  if (Array.isArray(r) && r.length) return Object.fromEntries(r.map((v) => [String(v).replace(/[^0-9a-z]/gi, "x"), String(v)]));
  return DEFAULT_RATIOS;
};
const apiUrl = () => String(cfg().apiUrl || "").trim();

// key "chatId:uid" -> { stage: "ask" | "opts", text, ratio, sound, chatId, msgId, replyTo, exp }
const sessions = new Map();
const keyOf = (chatId, uid) => `${chatId}:${uid}`;
const sweep = () => { const now = Date.now(); for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k); };

const BTN = (text, data, emoji, fallback) => ({ text, callback_data: data, ...(emoji ? { icon_custom_emoji_id: emoji, emoji_fallback: fallback } : {}) });

// ---------- tampilan ----------
const askView = (uid) => ({
  rich:
    title("🧩", "TextMatch") +
    quote(
      "✍️ <b>Kirim teks</b> yang ingin dibuat.",
      `Maksimal ${MAX_TEXT} karakter.`,
      "<i>Berlaku 3 menit.</i>"
    ),
  rows: [[BTN("Batalkan", `tm:x:${uid}`, "5210952531676504517", "❌")]],
});

function optsView(s, uid) {
  const rs = ratios();
  const ratioRow = Object.entries(rs).map(([code, val]) => BTN(`${s.ratio === val ? "✅ " : ""}${val}`, `tm:r:${code}:${uid}`));
  return {
    rich:
      title("🧩", "TextMatch") +
      table(["Info", "Detail"], [
        ["Teks", h(s.text)],
        ["Ratio", h(s.ratio)],
        ["Sound", s.sound ? "🔊 ON" : "🔇 OFF"],
      ]) +
      quote("Pilih <b>Ratio</b> dan <b>Sound</b>, lalu tekan <b>Buat</b>."),
    rows: [
      ratioRow,
      [BTN(s.sound ? "🔊 Sound: ON" : "🔇 Sound: OFF", `tm:s:${uid}`)],
      [BTN("Buat", `tm:go:${uid}`, "6120946172010959542", "✅"), BTN("Batalkan", `tm:x:${uid}`, "5210952531676504517", "❌")],
    ],
  };
}

const newSession = (chatId, uid, extra) => {
  sweep();
  const ratio = cfg().defaultRatio && Object.values(ratios()).includes(cfg().defaultRatio) ? cfg().defaultRatio : Object.values(ratios())[0];
  const s = { stage: "ask", text: "", ratio, sound: cfg().defaultSound !== false, chatId, msgId: null, exp: Date.now() + TTL, ...extra };
  sessions.set(keyOf(chatId, uid), s);
  return s;
};

// ---------- dipanggil dari plugin ----------
export async function startTextMatch(ctx, initialText = "") {
  const uid = ctx.from.id;
  const old = sessions.get(keyOf(ctx.chat.id, uid));
  if (old?.msgId) { dropAnim({ callbackQuery: { message: { chat: { id: old.chatId }, message_id: old.msgId } } }); ctx.telegram.deleteMessage(old.chatId, old.msgId).catch(() => {}); }

  const text = String(initialText || "").trim().slice(0, MAX_TEXT);
  const s = newSession(ctx.chat.id, uid, { replyTo: ctx.message?.message_id });
  if (!text) {
    const v = askView(uid);
    const sent = await replyView(ctx, v.rich, v.rows);
    s.msgId = sent?.message_id ?? null;
    return;
  }
  s.stage = "opts";
  s.text = text;
  const v = optsView(s, uid);
  const sent = await replyView(ctx, v.rich, v.rows);
  s.msgId = sent?.message_id ?? null;
}

// ---------- penangkap teks (didaftarkan di botSetup.js, sebelum messageHandler) ----------
export async function textMatchTextHandler(ctx, next) {
  if (!ctx.from || !ctx.chat) return next();
  const key = keyOf(ctx.chat.id, ctx.from.id);
  const s = sessions.get(key);
  if (!s || s.stage !== "ask") return next();
  if (s.exp < Date.now()) { sessions.delete(key); return next(); }
  const text = String(ctx.message?.text || "").trim();
  if (!text || text.startsWith("/") || (config.prefix && text.startsWith(config.prefix))) return next();

  s.text = text.slice(0, MAX_TEXT);
  s.stage = "opts";
  s.exp = Date.now() + TTL;
  if (s.msgId) { dropAnim({ callbackQuery: { message: { chat: { id: s.chatId }, message_id: s.msgId } } }); ctx.telegram.deleteMessage(s.chatId, s.msgId).catch(() => {}); }
  const v = optsView(s, ctx.from.id);
  const sent = await replyView(ctx, v.rich, v.rows);
  s.msgId = sent?.message_id ?? null;
}

// ---------- panggil API ----------
function sniff(buf) {
  if (buf.length > 12 && buf.slice(4, 8).toString("latin1") === "ftyp") return "video";
  if (buf.slice(0, 4).toString("hex") === "1a45dfa3") return "video"; // webm/mkv
  if (buf.slice(0, 3).toString("latin1") === "GIF") return "animation";
  if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a" || buf.slice(0, 3).toString("hex") === "ffd8ff") return "photo";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "photo";
  if (buf.slice(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio";
  if (buf.slice(0, 4).toString("latin1") === "OggS") return "audio";
  return null;
}
const kindFromType = (t) => (/^image\/gif/.test(t) ? "animation" : /^image\//.test(t) ? "photo" : /^video\//.test(t) ? "video" : /^audio\//.test(t) ? "audio" : null);

async function http(url, params) {
  const res = await axios.get(url, {
    params,
    responseType: "arraybuffer",
    timeout: 120000,
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    validateStatus: () => true,
  });
  return { status: res.status, type: String(res.headers["content-type"] || ""), buf: Buffer.from(res.data) };
}

/** Kembalikan { buffer, kind } dari respons API: langsung media, atau JSON berisi URL media */
export async function fetchTextMatch({ text, ratio, sound }) {
  const params = { text, ratio, sound: sound ? "true" : "false" };
  if (cfg().apiKey) params.apikey = cfg().apiKey;

  let r = await http(apiUrl(), params);
  let kind = kindFromType(r.type) || sniff(r.buf);
  if (kind && r.status < 400) return { buffer: r.buf, kind };

  let json;
  try { json = JSON.parse(r.buf.toString("utf8")); } catch { /* bukan JSON */ }
  if (!json) throw new Error(`Respons API tidak dikenali (HTTP ${r.status})`);

  const pickUrl = (o) => {
    if (!o) return null;
    if (typeof o === "string") return /^https?:\/\//i.test(o) ? o : null;
    for (const k of ["url", "video", "image", "audio", "download", "link", "result", "data"]) {
      const v = pickUrl(o[k]);
      if (v) return v;
    }
    return null;
  };
  const media = pickUrl(json.result) || pickUrl(json.data) || pickUrl(json);
  if (!media) throw new Error(json.message || json.error || json.msg || `API gagal (HTTP ${r.status})`);

  r = await http(media);
  kind = kindFromType(r.type) || sniff(r.buf) || (/\.(mp4|webm|mov)(\?|$)/i.test(media) ? "video" : /\.(mp3|m4a|ogg|opus)(\?|$)/i.test(media) ? "audio" : /\.gif(\?|$)/i.test(media) ? "animation" : "photo");
  if (r.status >= 400 || !r.buf.length) throw new Error(`Gagal mengunduh hasil (HTTP ${r.status})`);
  return { buffer: r.buf, kind };
}

// ---------- tombol ----------
registerCallback("tm", async (ctx, args) => {
  const uid = String(ctx.from.id);
  if (args[args.length - 1] !== uid) return ctx.answerCbQuery("Ini bukan menu kamu. Ketik /textmatch untuk membuat sendiri.", { show_alert: true });

  const m = ctx.callbackQuery?.message;
  const chatId = m?.chat?.id;
  const key = keyOf(chatId, uid);
  const s = sessions.get(key);
  const act = args[0];

  if (act === "x") {
    sessions.delete(key);
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Dibatalkan").catch(() => {});
  }
  if (!s || s.exp < Date.now() || s.stage !== "opts" || s.msgId !== m.message_id) {
    sessions.delete(key);
    await editCbView(ctx, note("⚠️", "Sesi berakhir", "Ketik /textmatch untuk mulai lagi.")).catch(() => {});
    return ctx.answerCbQuery().catch(() => {});
  }

  if (act === "r") {
    const val = ratios()[args[1]];
    if (!val) return ctx.answerCbQuery("Ratio tidak valid.", { show_alert: true });
    s.ratio = val;
  } else if (act === "s") {
    s.sound = !s.sound;
  } else if (act === "go") {
    sessions.delete(key);
    await ctx.answerCbQuery("Memproses...").catch(() => {});
    await editCbView(ctx, note("⏳", "Sedang membuat TextMatch", `Ratio ${h(s.ratio)} • Sound ${s.sound ? "ON" : "OFF"}<br>Mohon tunggu...`));
    try {
      const { buffer, kind } = await fetchTextMatch(s);
      const extra = { ...(s.replyTo ? { reply_parameters: { message_id: s.replyTo, allow_sending_without_reply: true } } : {}) };
      const src = { source: buffer, filename: kind === "video" ? "textmatch.mp4" : kind === "audio" ? "textmatch.mp3" : kind === "animation" ? "textmatch.gif" : "textmatch.png" };
      if (kind === "video") await ctx.telegram.sendVideo(chatId, src, { ...extra, supports_streaming: true });
      else if (kind === "audio") await ctx.telegram.sendAudio(chatId, src, extra);
      else if (kind === "animation") await ctx.telegram.sendAnimation(chatId, src, extra);
      else await ctx.telegram.sendPhoto(chatId, src, extra);
      dropAnim(ctx);
      await ctx.deleteMessage().catch(() => {});
    } catch (err) {
      await editCbView(ctx, note("❌", "Gagal membuat TextMatch", escH(err.message || "Terjadi kesalahan")));
    }
    return;
  } else {
    return ctx.answerCbQuery().catch(() => {});
  }

  s.exp = Date.now() + TTL;
  const v = optsView(s, uid);
  await editCbView(ctx, v.rich, v.rows);
  return ctx.answerCbQuery().catch(() => {});
});

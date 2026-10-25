import axios from "axios";
import { getUser } from "../database.js";
import { isOwner } from "../middleware.js";
import { registerCallback } from "./callbacks.js";
import { getCost, spend, refund } from "./coin.js";

// Login Satriam AMP via Magic Link (/camprem) dengan alur tombol:
//  email -> konfirmasi -> kirim link -> lihat link -> verify (kirim link) -> selesai
// step: email | confirm | sending | sent | viewed | verify

const BASE_URL = "https://satriam.satriadeveloperz.workers.dev";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Content-Type": "application/json",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
};
const TTL = 10 * 60 * 1000; // sesi kedaluwarsa 10 menit sejak aksi terakhir
const flows = new Map(); // userId -> { step, email, link, msgId, chatId, expires }

export const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const isMagicLink = (s = "") => /^https?:\/\/\S+$/i.test(s.trim());
const escHtml = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ===== API =====
function apiError(err) {
  const d = err.response?.data;
  if (d) return typeof d === "string" ? d.slice(0, 200) : d.message || d.error || JSON.stringify(d).slice(0, 200);
  return err.message;
}

export async function sendMagicLink(email) {
  try {
    const res = await axios.post(`${BASE_URL}/api/satriam/send-link`, { email }, { headers: HEADERS, timeout: 15000 });
    if (!res.data?.success) throw new Error(`Gagal kirim link: ${JSON.stringify(res.data)}`);
    return res.data;
  } catch (err) {
    throw new Error(apiError(err));
  }
}

export async function verifyMagicLink(email, magicLink) {
  try {
    const res = await axios.post(
      `${BASE_URL}/api/satriam/verify-link`,
      { email, magicLink },
      { headers: HEADERS, timeout: 15000 }
    );
    if (!res.data?.success) throw new Error(`Verifikasi gagal: ${JSON.stringify(res.data)}`);
    return res.data;
  } catch (err) {
    throw new Error(apiError(err));
  }
}

/** Cari URL magic link di respons API (kalau API mengembalikannya). Prioritas key yang mengandung "link"/"url" */
function findLink(data) {
  let any = null;
  const walk = (v, key = "") => {
    if (typeof v === "string" && isMagicLink(v)) {
      if (/link|url/i.test(key)) return v;
      any ||= v;
    } else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        const r = walk(val, k);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(data) || any;
}

// ===== State =====
function getFlow(userId) {
  const f = flows.get(String(userId));
  if (!f) return null;
  if (f.expires < Date.now()) {
    flows.delete(String(userId));
    return null;
  }
  return f;
}
function setFlow(userId, patch) {
  const key = String(userId);
  const f = { ...(flows.get(key) || {}), ...patch, expires: Date.now() + TTL };
  flows.set(key, f);
  return f;
}
const clearFlow = (userId) => flows.delete(String(userId));

// ===== Tombol =====
const btn = (text, action, uid) => ({ text, callback_data: `camprem:${action}:${uid}` });
const kb = (...rows) => ({ inline_keyboard: rows });
const NO_PREVIEW = { link_preview_options: { is_disabled: true } }; // cegah Telegram "membuka" magic link (sekali pakai)

// ===== Format teks Telegram (semua pakai parse_mode HTML) =====
// <b> tebal · <i> miring · <u> garis bawah · <s> coret · <code> mono (ketuk = salin)
// <tg-spoiler> spoiler · <blockquote> kutipan · <blockquote expandable> kutipan lipat
const HTML = { parse_mode: "HTML" };
const code = (s) => `<code>${escHtml(s)}</code>`;
const spoiler = (s) => `<tg-spoiler>${s}</tg-spoiler>`;
const quote = (s) => `<blockquote>${s}</blockquote>`;
const quoteFold = (s) => `<blockquote expandable>${s}</blockquote>`;

const TXT_EMAIL =
  `<tg-emoji emoji-id="6129731845442510016">🔐</tg-emoji> <b>LOGIN SATRIAM AMP</b>\n\n` +
  quote(`<tg-emoji emoji-id="5372825386591732174">📧</tg-emoji> Masukkan <b>email</b> kamu untuk login lewat <i>Magic Link</i>.`) +
  `\n\nKetik emailnya di chat ini, contoh:\n${code("nama@gmail.com")}\n\n` +
  quoteFold(
    `<b><tg-emoji emoji-id="6307686831735444755">📋</tg-emoji> Alur login</b>\n` +
      `<tg-emoji emoji-id="6120946172010959542">1️⃣</tg-emoji> Kirim email\n<tg-emoji emoji-id="6120946172010959542">2️⃣</tg-emoji> Konfirmasi email\n<tg-emoji emoji-id="6120946172010959542">3️⃣</tg-emoji> Bot meminta Magic Link\n<tg-emoji emoji-id="6120946172010959542">4️⃣</tg-emoji> Kirim URL Magic Link ke bot\n\n` +
      `<tg-emoji emoji-id="5969545478155539601">⏱</tg-emoji> <u>Sesi berakhir otomatis dalam 10 menit</u>\n` +
      `<tg-emoji emoji-id="6129731845442510016">🔒</tg-emoji> ${spoiler("Magic Link bersifat rahasia &amp; sekali pakai")}`
  );
const confirmText = (email) =>
  `<tg-emoji emoji-id="5372825386591732174">📧</tg-emoji> <b>Konfirmasi Email</b>\n\n${quote(code(email))}\n\nApakah email ini sudah <b>benar</b>?`;
const promptKb = (uid) => kb([btn("❌ Batal", "batal", uid)]);
const confirmKb = (uid) => kb([btn("✅ Lanjutkan", "ok", uid), btn("↩️ Kembali", "back", uid)]);

const edit = (ctx, text, extra = {}) => ctx.editMessageText(text, { ...NO_PREVIEW, ...HTML, ...extra }).catch(() => {});

/** Dipanggil oleh command /camprem */
export async function startFlow(ctx) {
  const uid = ctx.from.id;
  const old = getFlow(uid);
  if (old?.msgId) ctx.telegram.editMessageReplyMarkup(old.chatId, old.msgId, undefined, { inline_keyboard: [] }).catch(() => {});
  const m = await ctx.reply(TXT_EMAIL, { ...HTML, reply_markup: promptKb(uid) });
  setFlow(uid, { step: "email", email: null, link: null, msgId: m.message_id, chatId: ctx.chat.id });
}

// ===== Callback tombol =====
registerCallback("camprem", async (ctx, [action, ownerId]) => {
  const uid = ctx.from.id;
  if (String(uid) !== ownerId) return ctx.answerCbQuery("Ini bukan sesi kamu!", { show_alert: true });

  if (action === "batal") {
    clearFlow(uid);
    await ctx.answerCbQuery("Dibatalkan");
    return edit(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> <b>Dibatalkan</b>\n\n${quote(`Ketik ${code("/camprem")} untuk mulai lagi.`)}`);
  }

  const f = getFlow(uid);
  if (!f) {
    await ctx.answerCbQuery("Sesi berakhir. Ketik /camprem untuk mulai lagi.", { show_alert: true });
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  }
  const msgId = ctx.callbackQuery.message?.message_id;

  // Kembali -> masukkan email baru
  if (action === "back" && f.step === "confirm") {
    setFlow(uid, { step: "email", email: null, msgId });
    await ctx.answerCbQuery();
    return edit(ctx, TXT_EMAIL, { reply_markup: promptKb(uid) });
  }

  // Lanjutkan (email benar) -> kirim magic link (koin dipotong di sini, dikembalikan jika gagal)
  if (action === "ok" && f.step === "confirm") {
    const cost = isOwner(uid) ? 0 : getCost({ category: "tools" }, "camprem");
    if (cost > 0 && !spend(uid, cost)) {
      return ctx.answerCbQuery(
        `💰 Koin tidak cukup. Butuh ${cost} koin, koin kamu: ${getUser(uid).koin || 0}. Ketik /claim untuk klaim koin harian.`,
        { show_alert: true }
      );
    }
    setFlow(uid, { step: "sending", msgId }); // set sebelum await -> aman dari double tap
    await ctx.answerCbQuery();
    await edit(ctx, `<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> <b>Mengirim Magic Link...</b>\n\n${quote(`📧 ${code(f.email)}`)}\n<i>Mohon tunggu sebentar</i>`);
    try {
      const res = await sendMagicLink(f.email);
      setFlow(uid, { step: "sent", link: findLink(res) });
      await edit(
        ctx,
        `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> <b>Magic Link berhasil diminta!</b>\n\n${quote(`📧 ${code(f.email)}`)}\n\nKlik <b>Lanjutkan</b> untuk melihat magic link via bot.`,
        { reply_markup: kb([btn("✅ Lanjutkan", "view", uid)]) }
      );
      if (cost > 0) {
        await ctx.telegram
          .sendMessage(ctx.chat.id, `<tg-emoji emoji-id="6089104607328342288">💰</tg-emoji> Coin <b>-${cost}</b>\n<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> Sisa coin kamu: ${code(getUser(uid).koin || 0)}`, HTML)
          .catch(() => {});
      }
    } catch (err) {
      if (cost > 0) refund(uid, cost);
      setFlow(uid, { step: "confirm" });
      await edit(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> <b>Gagal kirim link</b>\n\n${quoteFold(escHtml(err.message))}\n<tg-emoji emoji-id="5372825386591732174">📧</tg-emoji> Email: ${code(f.email)}`, {
        reply_markup: kb([btn("🔄 Coba lagi", "ok", uid)], [btn("↩️ Kembali", "back", uid)]),
      });
    }
    return;
  }

  // Lanjutkan -> tampilkan magic link
  if (action === "view" && f.step === "sent") {
    setFlow(uid, { step: "viewed" });
    await ctx.answerCbQuery();
    const body = f.link
      ? `<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Magic Link kamu</b>\n\n${quote(spoiler(code(f.link)))}\n\n<i>Ketuk spoiler untuk membuka, lalu ketuk link untuk menyalin.</i>`
      : `<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Magic Link sudah dikirim</b> ke <b>${escHtml(f.email)}</b>.\n\n${quote(`Buka inbox (cek juga folder <u>spam</u>), lalu salin URL Magic Link-nya.`)}`;
    return edit(ctx, `${body}\n\nKlik <b>Lanjutkan</b> untuk verify.`, {
      reply_markup: kb([btn("✅ Lanjutkan", "verify", uid)]),
    });
  }

  // Lanjutkan -> minta user kirim magic link
  if (action === "verify" && f.step === "viewed") {
    setFlow(uid, { step: "verify" });
    await ctx.answerCbQuery();
    return edit(ctx, `<tg-emoji emoji-id="5372825386591732174">📩</tg-emoji> <b>Kirim Magic Link</b>\n\n${quote(`Silakan kirim URL magic link ke chat ini.\nContoh: ${code("https://...")}`)}`);
  }

  await ctx.answerCbQuery(); // tombol lama / langkah tidak cocok
});

// ===== Verifikasi =====
/** Verifikasi link lalu kirim hasilnya (ringkasan + file JSON lengkap) */
export async function finishLogin(ctx, email, magicLink) {
  const wait = await ctx.reply("<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> <i>Memverifikasi Magic Link...</i>", HTML);
  let result;
  try {
    result = await verifyMagicLink(email, magicLink.trim());
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    return ctx.reply(
      `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> <b>Verifikasi gagal</b>\n\n${quoteFold(escHtml(err.message))}\n<i>Link mungkin salah/kedaluwarsa.</i> Kirim ulang magic link yang benar, atau ketik ${code("/camprem")} untuk mulai dari awal.`,
      HTML
    );
  }
  clearFlow(ctx.from.id);
  await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
  ctx.deleteMessage().catch(() => {}); // hapus pesan berisi magic link (sensitif)

  await ctx.reply(
    `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> <b>Verifikasi berhasil!</b>\n\n` +
      quote(
        `<tg-emoji emoji-id="5372825386591732174">📧</tg-emoji> <b>Email:</b> ${code(email)}\n` +
          `<tg-emoji emoji-id="5422439311196834318">🆔</tg-emoji> <b>UID:</b> ${spoiler(code(result.uid))}\n` +
          `<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> <b>Plan:</b> ${code(result.planName)}\n` +
          `<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> <b>Valid Until:</b> ${code(result.validUntil)}`
      ),
    HTML
  );
  const filename = `AzmiStecuMD_${email.replace(/[@.]/g, "_")}.json`;
  await ctx.replyWithDocument(
    { source: Buffer.from(JSON.stringify(result, null, 2)), filename },
    {
      caption: `<tg-emoji emoji-id="5334882760735598374">📄</tg-emoji> <b>Data lengkap</b>\n${quote(`<tg-emoji emoji-id="6129731845442510016">🔒</tg-emoji> ${spoiler("Simpan baik-baik, jangan dibagikan ke siapa pun.")}`)}`,
      ...HTML,
    }
  );
}

/** Handler pesan biasa: menangkap email (step email) dan magic link (step verify) */
export async function pendingInputHandler(ctx, next) {
  try {
    if (ctx.chat?.type !== "private") return next();
    const f = getFlow(ctx.from.id);
    if (!f || (f.step !== "email" && f.step !== "verify")) return next();
    const text = (ctx.message?.text || "").trim();
    const user = getUser(ctx.from.id);
    if (user.banned && !isOwner(ctx.from.id)) return;

    if (f.step === "email") {
      if (!isEmail(text)) return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>Format email tidak valid.</b>\nCoba ketik lagi, contoh: ${code("nama@gmail.com")}`, HTML);
      if (f.msgId) ctx.telegram.editMessageReplyMarkup(f.chatId, f.msgId, undefined, { inline_keyboard: [] }).catch(() => {});
      const m = await ctx.reply(confirmText(text), { ...HTML, reply_markup: confirmKb(ctx.from.id) });
      setFlow(ctx.from.id, { step: "confirm", email: text, msgId: m.message_id });
      return;
    }

    // step verify
    if (!isMagicLink(text)) return ctx.reply(`<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>Itu bukan URL Magic Link.</b>\nKirim URL lengkap yang diawali ${code("https://")}`, HTML);
    setFlow(ctx.from.id, {}); // perpanjang sesi
    await finishLogin(ctx, f.email, text);
  } catch (err) {
    console.error("[SATRIAM] Error:", err);
    try { await ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> <b>Terjadi kesalahan</b> saat memproses.", HTML); } catch {}
  }
}

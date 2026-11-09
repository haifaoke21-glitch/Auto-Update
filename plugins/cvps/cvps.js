import config from "../../config.js";
import { genPassword } from "../../src/lib/cpanel/util.js";
import { canUseVps } from "../../src/lib/cpanel/roles.js";
import { checkLimit, consumeLimit, fmtLimit } from "../../src/lib/cpanel/limit.js";
import { registerCallback } from "../../src/lib/callbacks.js";
import { h, title, note, quote, para, table, fold, replyView, sendView, editView, dropAnim } from "../../src/lib/richUi.js";
import {
  vpsSpecs, vpsImages, vpsRegions, cvpsCfg, configuredDoSlots, accountKeyboard, cbGuard, editCb,
  createDroplet, waitForIp, autoHostname, cleanHostname, DENY_TEXT, NO_DO_TEXT,
} from "../../src/lib/cvps/do.js";

// hostname pilihan user (dari /cvps <hostname>) selama wizard berjalan
const pendingHost = new Map(); // uid -> { hostname, expires }
const TTL = 10 * 60 * 1000;
const getHost = (uid) => {
  const e = pendingHost.get(String(uid));
  return e && e.expires > Date.now() ? e.hostname : null;
};

const cancelRow = (uid) => [{ text: "Batal", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `cvps:x:${uid}` }];
const head = () => title("☁️", "Create VPS");
const info = (rows) => table(["Info", "Detail"], rows);

function accountMenu(uid) {
  return {
    rich: head() + quote("Pilih akun <b>Digital Ocean</b> yang akan dipakai untuk membuat VPS."),
    kb: accountKeyboard((s) => `cvps:a:${uid}:${s}`, [cancelRow(uid)]),
  };
}

/** Kirim detail login VPS: di chat pribadi langsung, di grup lewat DM (password tidak boleh tampil di grup) */
async function deliver(ctx, chatId, uid, rich) {
  if (ctx.callbackQuery.message.chat.type === "private") return sendView(ctx.telegram, chatId, rich);
  try {
    await sendView(ctx.telegram, uid, rich);
    await sendView(ctx.telegram, chatId, note("✅", "VPS berhasil dibuat", "Detail login (IP &amp; password) sudah dikirim lewat chat pribadi."));
  } catch {
    await sendView(ctx.telegram, chatId, note("⚠️", "VPS berhasil dibuat, tapi DM gagal", `Bot tidak bisa mengirim DM. Buka chat pribadi bot, tekan Start, lalu cek VPS lewat <code>${config.prefix}listvps</code> (password tidak ditampilkan di grup).`));
  }
}

async function createJob(ctx, { uid, chatId, msgId, acc, specId, osId, regId, hostname }) {
  const spec = vpsSpecs[specId], img = vpsImages[osId], reg = vpsRegions[regId];
  const password = genPassword(cvpsCfg().passwordLength);
  const edit = (rich) => editView(ctx.telegram, chatId, msgId, rich).catch(() => {});
  try {
    const dropletId = await createDroplet(acc, { hostname, spec: specId, os: osId, region: regId, password });
    const ip = await waitForIp(acc, dropletId);
    await consumeLimit(uid);
    if (!ip) {
      return edit(
        note("⚠️", "VPS dibuat, IP belum muncul", `Droplet <code>${dropletId}</code> sudah dibuat. Cek beberapa menit lagi lewat <code>${config.prefix}listvps</code>.<br><tg-emoji emoji-id="5330115548900501467">🔑</tg-emoji> Password root: <code>${h(password)}</code>`)
      );
    }
    await edit(note("✅", "VPS selesai dibuat", `Hostname: <code>${h(hostname)}</code>`));
    const rules = cvpsCfg().rules.map((r) => `• ${h(r)}`);
    await deliver(
      ctx, chatId, uid,
      title("✅", "Sukses Create VPS!") +
        table(["Detail", "Nilai"], [
          ["🌐 IP VPS", `<code>${ip}</code>`],
          ["🔑 Password", `<code>${h(password)}</code>`],
          ["🏷️ Hostname", `<code>${h(hostname)}</code>`],
          ["🆔 Droplet", `<code>${dropletId}</code>`],
          ["📦 Spec", h(spec.name)],
          ["💿 OS", h(img.name)],
          ["📍 Region", `${reg.flag} ${h(reg.name)}`],
        ]) +
        para(`Login: <code>ssh root@${ip}</code>`) +
        fold("⚠️ T.O.S VPS (tap untuk buka)", rules) +
        quote("Simpan data VPS kamu. Jika akun DO terkena suspend, garansi hangus.")
    );
  } catch (e) {
    console.error("[CVPS] gagal membuat VPS:", e.message);
    await edit(note("✕", "Gagal membuat VPS", h(e.message)));
  }
}

registerCallback("cvps", async (ctx, args) => {
  const [action, uid, acc, specId, osId, regId] = args;
  if (!(await cbGuard(ctx, uid))) return;

  if (action === "x") {
    pendingHost.delete(String(uid));
    dropAnim(ctx);
    await ctx.deleteMessage().catch(() => {});
    return ctx.answerCbQuery("Dibatalkan.");
  }
  if (action === "n") {
    const m = accountMenu(uid);
    await editCb(ctx, m.rich, m.kb);
    return ctx.answerCbQuery();
  }

  // 1) akun -> pilih spesifikasi
  if (action === "a") {
    const kb = Object.entries(vpsSpecs).map(([id, s]) => [{ text: `${s.icon} ${s.name}`, callback_data: `cvps:s:${uid}:${acc}:${id}` }]);
    kb.push([{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `cvps:n:${uid}` }, ...cancelRow(uid)]);
    await editCb(ctx, head() + info([["☁️ Akun DO", `<b>${h(acc)}</b>`]]) + para("Pilih spesifikasi VPS:"), kb);
    return ctx.answerCbQuery();
  }

  // 2) spesifikasi -> pilih OS
  if (action === "s") {
    const spec = vpsSpecs[specId];
    if (!spec) return ctx.answerCbQuery();
    const host = getHost(uid) || autoHostname(spec);
    const kb = Object.entries(vpsImages).map(([id, i]) => [{ text: `${i.name}`, icon_custom_emoji_id: "5463107823946717464", emoji_fallback: "💿", callback_data: `cvps:i:${uid}:${acc}:${specId}:${id}` }]);
    kb.push([{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `cvps:a:${uid}:${acc}` }, ...cancelRow(uid)]);
    await editCb(ctx, head() + info([["📦 Spec", `<b>${h(spec.name)}</b>`], ["🏷️ Hostname", `<code>${h(host)}</code>`]]) + para("Pilih OS image:"), kb);
    return ctx.answerCbQuery();
  }

  // 3) OS -> pilih region
  if (action === "i") {
    const spec = vpsSpecs[specId], img = vpsImages[osId];
    if (!spec || !img) return ctx.answerCbQuery();
    const kb = Object.entries(vpsRegions).map(([id, r]) => [{ text: `${r.flag} ${r.name} — ${r.latency}`, callback_data: `cvps:r:${uid}:${acc}:${specId}:${osId}:${id}` }]);
    kb.push([{ text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "6123107313654960925", emoji_fallback: "⬅️", callback_data: `cvps:s:${uid}:${acc}:${specId}` }, ...cancelRow(uid)]);
    await editCb(ctx, head() + info([["📦 Spec", `<b>${h(spec.name)}</b>`], ["💿 Image", `<b>${h(img.name)}</b>`]]) + para("Pilih region:"), kb);
    return ctx.answerCbQuery();
  }

  // 4) region -> buat VPS
  if (action === "r") {
    const spec = vpsSpecs[specId], img = vpsImages[osId], reg = vpsRegions[regId];
    if (!spec || !img || !reg) return ctx.answerCbQuery();
    const lim = checkLimit(uid);
    if (!lim.allowed) {
      return ctx.answerCbQuery(`Limit habis (${lim.used}/${fmtLimit(lim.limit)}). Hubungi owner untuk menambah limit.`, { show_alert: true });
    }
    const hostname = getHost(uid) || autoHostname(spec);
    pendingHost.delete(String(uid));
    await ctx.answerCbQuery("Membuat VPS...");
    const msg = ctx.callbackQuery.message;
    await editCb(
      ctx,
      title("⏳", "Membuat VPS...") +
        info([["📦 Spec", h(spec.name)], ["🏷️ Hostname", `<code>${h(hostname)}</code>`], ["💿 OS", h(img.name)], ["📍 Region", `${reg.flag} ${h(reg.name)}`]]) +
        quote("<i>Proses ±1–3 menit.</i>")
    );
    // Jalan di latar belakang: handler callback tidak boleh menunggu (batas waktu handler Telegraf 90 dtk)
    createJob(ctx, { uid: ctx.from.id, chatId: msg.chat.id, msgId: msg.message_id, acc, specId, osId, regId, hostname }).catch((e) => console.error("[CVPS]", e));
  }
});

export default {
  command: ["cvps"],
  category: "cvps",
  description: "Buat VPS DigitalOcean lewat tombol (Reseller VPS+). Contoh: /cvps namahost",
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const uid = ctx.from.id;
    if (!canUseVps(uid)) return replyView(ctx, DENY_TEXT);
    if (!configuredDoSlots().length) return replyView(ctx, NO_DO_TEXT);
    const hostname = cleanHostname(args.join(" "));
    pendingHost.set(String(uid), { hostname: hostname || null, expires: Date.now() + TTL });
    const m = accountMenu(uid);
    return replyView(ctx, m.rich, m.kb);
  },
};

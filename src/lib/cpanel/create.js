// Alur pembuatan panel (user + server Node [+ Python pendamping]) dan Admin Panel
import { h, cfg, inGroup, genPassword } from "./util.js";
import { replyView, replyNote, sendView, editView, editCbView, title, note, quote, para, table } from "../richUi.js";
import { isStaff, canCreatePanel, canCreateAdmin, slotLabel } from "./roles.js";
import { getPanel, getSetting, slotName, createUser, createServer, deleteUser, listEggChoices, getEggDetail, eggRuntime, eggSummary, RUNTIME_LABEL } from "./ptero.js";
import { registerCallback } from "../callbacks.js";
import { checkLimit, consumeLimit, fmtLimit } from "./limit.js";
import { isOwner } from "../../middleware.js";
import config from "../../../config.js";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;
const busy = new Set(); // cegah double-submit dari user yang sama

/** spec RAM: gb angka (1-10) atau "unli" */
export function specFor(size) {
  if (size === "unli") return { label: "Unlimited", memory: 0, disk: 0, cpu: 0 };
  const n = Number(size);
  return { label: `${n}GB`, memory: n * 1024, disk: n * 1024, cpu: n * 30 };
}

const rulesLines = () => cfg().rules.map((r) => `• ${h(r)}`);

async function sendCredentials(ctx, targetId, rich, domain) {
  try {
    await sendView(ctx.telegram, targetId, rich, [[{ text: "Login Panel", icon_custom_emoji_id: "6129731845442510016", emoji_fallback: "🔐", url: `${domain}/` }]]);
    return true;
  } catch {
    return false;
  }
}

async function notifyChannel(ctx, rich) {
  const id = cfg().notifChannelId;
  if (!id) return;
  try {
    await sendView(ctx.telegram, id, rich);
  } catch (e) {
    console.warn("[CPANEL] notif channel gagal:", e.message);
  }
}

/** Validasi umum. Mengembalikan { panel, targetId } atau null (sudah membalas error) */
async function precheck(ctx, { slot, kind }) {
  const uid = ctx.from.id;

  if (!getSetting("panelres") && !isStaff(uid)) {
    await replyNote(ctx, "⊘", "Create panel dimatikan", "Pembuatan panel sedang dimatikan oleh owner.");
    return null;
  }
  if (kind === "admin" && !getSetting("paneladp") && !isStaff(uid)) {
    await replyNote(ctx, "⊘", "Create admin panel dimatikan", "Create Admin Panel sedang dimatikan oleh owner.");
    return null;
  }
  if (cfg().groupOnly && !inGroup(ctx) && !isStaff(uid)) {
    await replyNote(ctx, "✕", "Hanya untuk grup", "Fitur ini hanya dapat digunakan di dalam grup.<br>Data login akan dikirim lewat DM supaya tidak tersebar.");
    return null;
  }
  const allowed = kind === "admin" ? canCreateAdmin(uid, slot === "adp" ? "1" : slot) : canCreatePanel(uid, slot);
  if (!allowed) {
    const need = kind === "admin" ? `Premium ${slotLabel(slot === "adp" ? "1" : slot)}` : `Reseller ${slotLabel(slot)}`;
    await replyNote(ctx, "✕", "Akses belum ada", `Kamu belum punya akses <b>${h(need)}</b>.<br>Hubungi owner / admin untuk mendapatkannya.`);
    return null;
  }
  if (!getPanel(slot)) {
    await replyNote(ctx, "✕", `${h(slotName(slot))} belum dikonfigurasi`, isOwner(uid) ? `Gunakan <code>${config.prefix}setpanel ${slot} &lt;domain&gt; &lt;plta&gt; &lt;pltc&gt;</code>` : "Hubungi owner bot.");
    return null;
  }
  const lim = checkLimit(uid);
  if (!lim.allowed) {
    await replyView(ctx, title("⊘", "Limit Habis") + table(["Info", "Nilai"], [["Role", `<b>${h(lim.role.toUpperCase())}</b>`], ["Limit", fmtLimit(lim.limit)], ["Terpakai", `${lim.used}x`]]) + quote("Hubungi owner untuk menambah limit."));
    return null;
  }
  return true;
}

/** Tentukan penerima data login: balasan pesan > pembuat. Harus pernah /start bot. */
async function pickTarget(ctx) {
  const rep = ctx.message?.reply_to_message?.from;
  const target = rep && !rep.is_bot ? rep : ctx.from;
  try {
    await ctx.telegram.getChat(target.id);
    return target;
  } catch {
    await replyNote(ctx, "✕", "DM belum bisa dikirim", `Bot belum bisa mengirim DM ke ${h(target.first_name || target.id)}.<br>Pastikan dia sudah menekan <b>/start</b> di chat pribadi bot, lalu ulangi.`);
    return null;
  }
}

// ============================================================
//  WIZARD PILIH EGG (wajib) — seperti bot CPANEL:
//  /2gb nama -> tombol runtime (Node.js / Python / Batal) -> tombol egg -> panel dibuat.
//  Tidak ada pemilihan egg otomatis: panel baru dibuat setelah user menekan tombol egg.
// ============================================================
const WIZARD_TIMEOUT_MS = 3 * 60 * 1000;
const wizards = new Map(); // token -> state
const wizardByUser = new Map(); // uid -> token (1 wizard aktif per user)

const newToken = () => Math.random().toString(36).slice(2, 8);
const CANCEL_ROW = (tok, back) => [
  ...(back ? [{ text: "← Kembali", callback_data: `cpegg:bk:${tok}` }] : []),
  { text: "× Batal", callback_data: `cpegg:x:${tok}` },
];

const runtimeRows = (tok) => [
  [
    { text: "† Node.js", callback_data: `cpegg:rt:${tok}:node` },
    { text: "† Python", callback_data: `cpegg:rt:${tok}:python` },
  ],
  CANCEL_ROW(tok, false),
];

function eggRows(tok, choices) {
  const rows = [];
  for (let i = 0; i < choices.length; i += 2) {
    const row = [{ text: `† ${choices[i].name}`, callback_data: `cpegg:eg:${tok}:${i}` }];
    if (choices[i + 1]) row.push({ text: `† ${choices[i + 1].name}`, callback_data: `cpegg:eg:${tok}:${i + 1}` });
    rows.push(row);
  }
  rows.push(CANCEL_ROW(tok, true));
  return rows;
}

/** Tampilan wizard (rich): judul + tabel info + pesan langkah. extra = HTML rich */
function wizardText(st, extra) {
  return (
    title("🖥️", `Create Panel ${h(st.label.toUpperCase())}`) +
    table(["Info", "Detail"], [
      ["Nama", `<code>${h(st.name)}</code>`],
      ["Panel", h(slotName(st.slot))],
      ...(st.runtime ? [["Runtime", RUNTIME_LABEL[st.runtime]]] : []),
    ]) +
    para(extra)
  );
}

function dropWizard(tok) {
  const st = wizards.get(tok);
  if (!st) return null;
  clearTimeout(st.timer);
  wizards.delete(tok);
  if (wizardByUser.get(st.uid) === tok) wizardByUser.delete(st.uid);
  return st;
}

/** /1gb nama , /unli nama , /2gbv3 nama ... */
export async function createPanelFlow(ctx, { slot, size, args }) {
  const uid = ctx.from.id;
  const label = specFor(size).label;
  const name = String(args[0] || "").trim().toLowerCase();
  const cmdHint = `${config.prefix}${size === "unli" ? "unli" : size + "gb"}${slot === "1" ? "" : "v" + slot}`;

  if (!name) return replyNote(ctx, "✕", "Format salah", `Contoh: <code>${cmdHint} namapanel</code><br>(balas pesan user agar data login dikirim ke dia)`);
  if (!USERNAME_RE.test(name)) return replyNote(ctx, "✕", "Nama tidak valid", "Nama panel hanya boleh huruf kecil, angka, titik, strip atau underscore (3–20 karakter).");
  if (!(await precheck(ctx, { slot, kind: "panel" }))) return;
  if (busy.has(uid)) return replyNote(ctx, "⏳", "Masih diproses", "Permintaan sebelumnya masih diproses.");
  const target = await pickTarget(ctx);
  if (!target) return;

  // Ganti wizard lama milik user ini (kalau ada)
  const oldTok = wizardByUser.get(uid);
  if (oldTok) {
    const old = dropWizard(oldTok);
    if (old) editView(ctx.telegram, old.chatId, old.messageId, note("⌛", "Dibatalkan", "Diganti permintaan baru.")).catch(() => {});
  }

  const tok = newToken();
  const st = { tok, uid, chatId: ctx.chat.id, messageId: null, slot, size, label, name, target: { id: target.id, first_name: target.first_name }, eggs: null, runtime: null, creator: { id: ctx.from.id, username: ctx.from.username || null } };
  const sent = await replyView(ctx, wizardText(st, "Pilih runtime server:"), runtimeRows(tok));
  st.messageId = sent.message_id;
  st.timer = setTimeout(() => {
    if (!dropWizard(tok)) return;
    editView(ctx.telegram, st.chatId, st.messageId, note("⌛", "Waktu pilih egg habis", "Jalankan perintah lagi.")).catch(() => {});
  }, WIZARD_TIMEOUT_MS);
  wizards.set(tok, st);
  wizardByUser.set(uid, tok);
}

/** Eksekusi pembuatan panel setelah egg dipilih */
async function executeCreate(ctx, st, choice) {
  const { uid, slot, size, label, name, target } = st;
  if (busy.has(uid)) return ctx.answerCbQuery("⏳ Permintaan sebelumnya masih diproses.", { show_alert: true }).catch(() => {});
  busy.add(uid);
  const edit = (rich, rows) => editView(ctx.telegram, st.chatId, st.messageId, rich, rows).catch(() => {});

  try {
    await edit(
      title("⏳", "Membuat Panel...") +
        table(["Info", "Detail"], [["Tipe", `<b>${h(label)}</b>`], ["Panel", h(slotName(slot))], ["Egg", `<b>${h(choice.name)}</b>`]])
    );
    const spec = specFor(size);
    const panel = getPanel(slot);
    if (!panel) return edit(note("✕", `${h(slotName(slot))} belum dikonfigurasi`));

    // Validasi egg dulu sebelum membuat user/server apa pun
    const ed = await getEggDetail(slot, choice);
    if (!ed.ok) return edit(note("✕", "Egg bermasalah", h(ed.error)));

    const password = genPassword(10);
    const u = await createUser(slot, { username: name, email: `${name}@${cfg().emailDomain}`, password });
    if (!u.ok) return edit(note("✕", "Gagal membuat user", h(u.error)));

    const srvName = st.runtime === "python" ? `${name}-${label}-py` : `${name}-${label}`;
    const s = await createServer(slot, { userId: u.user.id, name: srvName, egg: ed.egg, limits: spec });
    if (!s.ok) {
      await deleteUser(slot, u.user.id); // jangan tinggalkan user yatim
      return edit(note("✕", "Gagal membuat server", `${h(s.error)}<br>User sementara sudah dihapus, silakan coba lagi.`));
    }

    await consumeLimit(uid);

    const eggLabel = `${RUNTIME_LABEL[st.runtime]} (${choice.name})`;
    const card =
      title("✅", `Data Panel ${h(label.toUpperCase())} Anda`) +
      table(["Detail", "Nilai"], [
        ["🌐 Login", `${h(panel.domain)}/`],
        ["👤 Username", `<code>${h(u.user.username)}</code>`],
        ["🔑 Password", `<code>${h(password)}</code>`],
        ["🥚 Egg", h(eggLabel)],
      ]) +
      quote("<b><tg-emoji emoji-id=\"5956561916573782596\">📜</tg-emoji> Rules Panel</b>", ...rulesLines());
    const sent = await sendCredentials(ctx, target.id, card, panel.domain);

    await edit(
      sent
        ? note("✅", `Panel ${h(label)} berhasil dibuat`, `<tg-emoji emoji-id="5264919878082509254">🥚</tg-emoji> Egg: ${h(eggLabel)}<br>Data login dikirim ke DM <b>${h(target.first_name || target.id)}</b>.`)
        : note("⚠️", "Panel dibuat, tapi DM gagal", `Username: <code>${h(u.user.username)}</code> (ID ${u.user.id}).<br>Reset password lewat <code>${config.prefix}gantipwuser ${u.user.id}</code>.`)
    );
    await notifyChannel(
      ctx,
      title("🖥️", "Panel Baru") +
        table(["Info", "Detail"], [
          ["Panel", h(slotName(slot))],
          ["Tipe", h(label)],
          ["Egg", h(eggLabel)],
          ["Username", `<code>${h(u.user.username)}</code>`],
          ["Dibuat oleh", h(st.creator.username ? "@" + st.creator.username : st.creator.id)],
        ])
    );
  } catch (e) {
    console.error("[CPANEL] createPanel:", e);
    edit(note("✕", "Terjadi kesalahan", "Gagal saat membuat panel."));
  } finally {
    busy.delete(uid);
  }
}

// Tombol wizard: cpegg:<aksi>:<token>[:<nilai>]
registerCallback("cpegg", async (ctx, [action, tok, val]) => {
  const st = wizards.get(tok);
  if (!st) return ctx.answerCbQuery("Proses sudah kedaluwarsa. Jalankan perintah lagi.", { show_alert: true });
  if (ctx.from.id !== st.uid) return ctx.answerCbQuery("Tombol ini bukan milik kamu.", { show_alert: true });

  const show = (rich, rows) => editCbView(ctx, rich, rows).catch(() => {});

  if (action === "x") {
    dropWizard(tok);
    await ctx.answerCbQuery("Dibatalkan.").catch(() => {});
    return editCbView(ctx, note("×", "Create panel dibatalkan")).catch(() => {});
  }

  if (action === "bk") {
    st.runtime = null;
    await ctx.answerCbQuery().catch(() => {});
    return show(wizardText(st, "Pilih runtime server:"), runtimeRows(tok));
  }

  if (action === "rt") {
    if (!RUNTIME_LABEL[val]) return ctx.answerCbQuery("Runtime tidak valid.", { show_alert: true });
    await ctx.answerCbQuery(`${RUNTIME_LABEL[val]}...`).catch(() => {});
    try {
      if (!st.eggs || st.eggs.listError) st.eggs = await listEggChoices(st.slot);
      const matches = st.eggs.filter((e) => (e.fallback || eggRuntime(e)) === val);
      if (!matches.length) {
        return show(wizardText(st, `<tg-emoji emoji-id="5420323339723881652">⚠</tg-emoji> Egg ${RUNTIME_LABEL[val]} belum tersedia di panel.<br>${h(eggSummary(st.eggs))}<br>Pilih runtime lain atau batal.`), runtimeRows(tok));
      }
      st.runtime = val;
      st.choices = matches;
      return show(wizardText(st, `Pilih Egg ${RUNTIME_LABEL[val]}:`), eggRows(tok, matches));
    } catch (e) {
      console.error("[CPANEL] gagal ambil egg:", e.message);
      st.eggs = null; // paksa ambil ulang saat ditekan lagi
      return show(wizardText(st, `<tg-emoji emoji-id="5420323339723881652">⚠</tg-emoji> Gagal mengambil egg dari panel: ${h(String(e.message).slice(0, 150))}<br>Coba tekan lagi atau batal.`), runtimeRows(tok));
    }
  }

  if (action === "eg") {
    const choice = st.choices?.[Number(val)];
    if (!st.runtime || !choice) return ctx.answerCbQuery("Egg tidak ditemukan. Pilih ulang.", { show_alert: true });
    await ctx.answerCbQuery(`${choice.name} dipilih.`).catch(() => {});
    dropWizard(tok); // wizard selesai; eksekusi pembuatan berjalan sendiri
    return executeCreate(ctx, st, choice);
  }

  return ctx.answerCbQuery().catch(() => {});
});

/** /cadp nama  atau  /cadp nama,idtele  ;  /cadpv2 ... */
export async function createAdminFlow(ctx, { slot, args }) {
  const uid = ctx.from.id;
  // Mode ADP: /cadp biasa memakai panel slot "adp" bila diaktifkan owner
  const useSlot = slot === "1" && getSetting("adp") && getPanel("adp") ? "adp" : slot;
  const raw = args.join(" ").trim();
  const [namePart, idPart] = raw.split(",").map((x) => x?.trim());
  const name = (namePart || "").toLowerCase();
  const hint = `${config.prefix}cadp${slot === "1" ? "" : "v" + slot}`;

  if (!name) return replyNote(ctx, "✕", "Format salah", `Contoh:<br><code>${hint} namaadmin</code><br><code>${hint} namaadmin,idtelegram</code>`);
  if (!USERNAME_RE.test(name)) return replyNote(ctx, "✕", "Nama tidak valid", "Nama hanya boleh huruf kecil, angka, titik, strip atau underscore (3–20 karakter).");
  if (!(await precheck(ctx, { slot: useSlot, kind: "admin" }))) return;
  if (busy.has(uid)) return replyNote(ctx, "⏳", "Masih diproses", "Permintaan sebelumnya masih diproses.");

  let target = ctx.from;
  if (idPart) {
    if (!/^\d{5,15}$/.test(idPart)) return replyNote(ctx, "✕", "ID tidak valid", "ID Telegram target harus angka.");
    target = { id: idPart, first_name: idPart };
  }
  try {
    await ctx.telegram.getChat(target.id);
  } catch {
    return replyNote(ctx, "✕", "DM belum bisa dikirim", "Bot belum bisa mengirim DM ke target. Minta dia menekan /start di chat pribadi bot dulu.");
  }

  busy.add(uid);
  try {
    const panel = getPanel(useSlot);
    const password = genPassword(10);
    const u = await createUser(useSlot, { username: name, email: `${name}@${cfg().emailDomain}`, password, admin: true });
    if (!u.ok) return replyNote(ctx, "✕", "Gagal membuat admin panel", h(u.error));
    await consumeLimit(uid);

    const card =
      title("✅", "Admin Panel Berhasil Dibuat") +
      table(["Detail", "Nilai"], [
        ["🌐 Login", `${h(panel.domain)}/`],
        ["👤 Username", `<code>${h(u.user.username)}</code>`],
        ["🔑 Password", `<code>${h(password)}</code>`],
      ]) +
      quote("<b><tg-emoji emoji-id=\"5956561916573782596\">📜</tg-emoji> Rules Admin Panel</b>", "• No rusuh panel", "• No DDoS", "• Simpan data akun", "• No share free");
    const sent = await sendCredentials(ctx, target.id, card, panel.domain);
    await (sent
      ? replyNote(ctx, "✅", "Admin Panel dibuat", `ID <code>${u.user.id}</code>. Data login dikirim lewat DM.`)
      : replyNote(ctx, "⚠️", "Admin Panel dibuat, tapi DM gagal", `ID <code>${u.user.id}</code>.<br>Reset password: <code>${config.prefix}gantipwuser ${u.user.id}</code>`));
    await notifyChannel(
      ctx,
      title("🛡️", "Admin Panel Baru") +
        table(["Info", "Detail"], [
          ["Panel", h(slotName(useSlot))],
          ["Username", `<code>${h(u.user.username)}</code>`],
          ["Dibuat oleh", h(ctx.from.username ? "@" + ctx.from.username : ctx.from.id)],
        ])
    );
  } catch (e) {
    console.error("[CPANEL] createAdmin:", e);
    replyNote(ctx, "✕", "Terjadi kesalahan", "Gagal saat membuat admin panel.");
  } finally {
    busy.delete(uid);
  }
}

import { getGroup, saveGroup } from "../../src/database.js";
import { richSay, requireBotRight, fmtDuration } from "../../src/lib/groupUtil.js";
import { quote, title, para } from "../../src/lib/richUi.js";
import { E, emo } from "../../src/lib/emo.js";
import { floodCfg } from "../../src/lib/antiFlood.js";
import { isStrict, STRICT_MUTE_SEC } from "../../src/lib/strictMode.js";

// Semua fitur yang dinyalakan/dimatikan bersamaan oleh Mode Ketat:
// [ikon, nama, kunci di database, getter status, setter ON]
const FEATURES = [
  ["🌐", "Anti Link", "antilink", (g) => Boolean(g.antilink), () => ({ antilink: true })],
  ["✅", "Anti Promosi", "antipromosi", (g) => Boolean(g.antipromosi), () => ({ antipromosi: true })],
  ["🚫", "Anti Spam", "antispam", (g) => Boolean(g.antispam), () => ({ antispam: true })],
  ["🛒", "Anti Admin", "antiadmin", (g) => Boolean(g.antiadmin), () => ({ antiadmin: true })],
  ["🤖", "Anti Bot", "antibot", (g) => Boolean(g.antibot), () => ({ antibot: true })],
  ["🔁", "Anti Forward", "antiforward", (g) => Boolean(g.antiforward), () => ({ antiforward: true })],
  ["⚡", "Anti Flood", "antiflood", (g) => floodCfg(g.antiflood).on, (g) => ({ antiflood: { ...floodCfg(g.antiflood), on: true } })],
];

const badge = (v) => (v ? `${E.ok} ON` : `${E.warn} OFF`);

// Tabel FITUR | STATUS (kolom status rata kanan, seperti tampilan Rich Message)
function featureTable(g) {
  const rows = [...FEATURES.map(([ic, name, , get]) => [`${emo(ic)} ${name}`, badge(get(g))]), [`${E.shield} Mode Ketat`, badge(isStrict(g))]];
  return (
    `<table bordered striped><tr><th align="center">FITUR</th><th align="center">STATUS</th></tr>` +
    rows.map(([a, b]) => `<tr><td>${a}</td><td align="right">${b}</td></tr>`).join("") +
    `</table>`
  );
}

const muteText = fmtDuration(STRICT_MUTE_SEC);

function infoView(g) {
  const names = FEATURES.map(([, n]) => n.replace("Anti ", "anti").toLowerCase().replace(/\s/g, ""));
  return (
    title(E.shield, "MODE KETAT") +
    para(`Satu perintah untuk mengaktifkan <b>semua</b> satpam sekaligus: ${names.slice(0, -1).join(", ")}, dan ${names.at(-1)}.`) +
    para(`<b>Saat ON:</b> setiap pelanggaran (promosi, link, forward, tag admin, spam, flood) langsung dihapus + <b>mute ${muteText}</b>. Anti Bot mengeluarkan bot yang ditambahkan member. Admin dan owner tidak terkena.`) +
    para(`<b>Saat OFF:</b> pengaturan satpam dikembalikan seperti sebelum Mode Ketat dinyalakan.`) +
    para(`Format: <code>/modeketat on</code> atau <code>/modeketat off</code>`) +
    featureTable(g)
  );
}

export default {
  command: ["modeketat"],
  category: "group",
  description: `Aktif/nonaktifkan sekaligus semua satpam grup; pelanggar dihapus + mute ${muteText}. Contoh: /modeketat on | off`,
  adminOnly: true,
  groupOnly: true,
  cooldown: 3000,
  run: async (ctx, { args }) => {
    const sub = (args[0] || "").toLowerCase();
    const g = getGroup(ctx.chat.id);
    if (sub !== "on" && sub !== "off") return richSay(ctx, infoView(g));

    const on = sub === "on";
    const wasStrict = isStrict(g);
    let patch;
    let restored = false;

    if (on) {
      // Simpan status satpam SEBELUM Mode Ketat (jangan ditimpa kalau sudah ON)
      const prev = wasStrict && g.modeketat?.prev
        ? g.modeketat.prev
        : Object.fromEntries(FEATURES.map(([, , key]) => [key, key === "antiflood" ? (g.antiflood ? { ...g.antiflood } : null) : Boolean(g[key])]));
      patch = { ...Object.assign({}, ...FEATURES.map(([, , , , set]) => set(g))), modeketat: { on: true, prev, at: wasStrict ? g.modeketat.at || Date.now() : Date.now() } };
    } else if (wasStrict && g.modeketat?.prev) {
      // Pulihkan status sebelum Mode Ketat
      const prev = g.modeketat.prev;
      patch = Object.fromEntries(FEATURES.map(([, , key]) => [
        key,
        key === "antiflood" ? prev.antiflood || { ...floodCfg(g.antiflood), on: false } : Boolean(prev[key]),
      ]));
      patch.modeketat = null;
      restored = true;
    } else {
      // Tidak ada snapshot (Mode Ketat belum pernah dinyalakan lewat flag): matikan semua
      patch = { ...Object.assign({}, ...FEATURES.map(([, , key]) => (key === "antiflood" ? { antiflood: { ...floodCfg(g.antiflood), on: false } } : { [key]: false }))), modeketat: null };
    }

    await saveGroup(ctx.chat.id, patch);
    const after = getGroup(ctx.chat.id);

    // Balasan dikirim dulu; cek izin bot berjalan setelahnya supaya tidak menunda respons
    await richSay(
      ctx,
      title(E.shield, on ? "MODE KETAT ON" : "MODE KETAT OFF") +
        featureTable(after) +
        quote(
          on
            ? `Semua satpam aktif. Pelanggar dihapus pesannya + mute ${muteText}.`
            : restored
              ? "Mode Ketat dimatikan. Pengaturan satpam dikembalikan seperti sebelumnya."
              : "Semua satpam dinonaktifkan."
        )
    );

    if (on) {
      // Cukup satu kartu: kalau bot belum admin, izin kedua tidak perlu dicek lagi
      if (await requireBotRight(ctx, "can_delete_messages", "Hapus pesan")) {
        await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna");
      }
    }
  },
};

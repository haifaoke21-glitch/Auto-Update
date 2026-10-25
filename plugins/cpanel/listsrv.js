import config from "../../config.js";
import { cmdName } from "../../src/lib/cpanel/util.js";
import { h, title, quote, table, replyView, replyNote, editView, note } from "../../src/lib/richUi.js";
import { isStaff, MAX_SLOT } from "../../src/lib/cpanel/roles.js";
import { getActiveSlot, getPanel, listAll, slotName } from "../../src/lib/cpanel/ptero.js";
import { STAFF_DENY } from "../../src/lib/cpanel/util.js";

const PER_PAGE = 15;
const hidden = [];
for (let v = 2; v <= MAX_SLOT; v++) hidden.push(`listsrv${v}`, `listsrvoff${v}`, `listadmin${v}`);

export default {
  command: ["listsrv", "listsrvoff", "listadmin"],
  hiddenCommands: hidden,
  category: "cpanel",
  description: "Daftar server aktif/suspend & admin (Owner+). Contoh: /listsrv 2 (hal. 2) atau /listsrv2 (panel V2)",
  cooldown: 4000,
  run: async (ctx, { args }) => {
    if (!isStaff(ctx.from.id)) return replyView(ctx, STAFF_DENY);
    const m = cmdName(ctx).match(/^(listsrvoff|listsrv|listadmin)(\d+)?$/);
    if (!m) return;
    const [, kind, suffix] = m;
    const slot = suffix || getActiveSlot();
    if (!getPanel(slot)) return replyNote(ctx, "✕", `${h(slotName(slot))} belum dikonfigurasi`, `Atur lewat <code>${config.prefix}setpanel</code>.`);

    const wait = await replyNote(ctx, "⏳", "Mengambil data...", "Mohon tunggu sebentar.");
    const edit = (rich) => editView(ctx.telegram, wait.chat.id, wait.message_id, rich);
    const isAdmin = kind === "listadmin";
    const res = await listAll(slot, isAdmin ? "users" : "servers");
    if (!res.ok) return edit(note("✕", "Gagal mengambil data", h(res.error)));

    let items = res.items;
    if (isAdmin) items = items.filter((u) => u.root_admin);
    else if (kind === "listsrvoff") items = items.filter((s) => s.suspended);
    else items = items.filter((s) => !s.suspended);

    const pages = Math.max(Math.ceil(items.length / PER_PAGE), 1);
    const page = Math.min(Math.max(parseInt(args[0]) || 1, 1), pages);
    const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const [icon, label] = isAdmin ? ["👑", "Daftar Admin Panel"] : kind === "listsrvoff" ? ["⛔", "Server Suspend"] : ["🟢", "Server Aktif"];

    const rows = slice.map((x, i) => {
      const n = String((page - 1) * PER_PAGE + i + 1);
      return isAdmin
        ? [n, `<b>${h(x.username)}</b>`, `<code>${x.id}</code>`]
        : [n, `<b>${h(x.name)}</b>`, `<code>${x.id}</code>`, `<code>${x.user}</code>`];
    });

    return edit(
      title(icon, label) +
        table(["Info", "Nilai"], [["Panel", h(slotName(slot))], ["Total", String(items.length)], ["Halaman", `${page}/${pages}`]]) +
        (rows.length ? table(isAdmin ? ["No", "Username", "ID"] : ["No", "Server", "ID", "User"], rows) : "<p><i>Tidak ada data.</i></p>") +
        (pages > 1 ? quote(`Halaman lain: <code>${config.prefix}${kind}${suffix || ""} ${page < pages ? page + 1 : 1}</code>`) : "")
    );
  },
};

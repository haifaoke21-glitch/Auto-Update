import { getGroup } from "../../src/database.js";
import { esc, mention, fullName, richSay } from "../../src/lib/groupUtil.js";
import { title, table, quote, fold } from "../../src/lib/richUi.js";
import { E, emo } from "../../src/lib/emo.js";
import { floodCfg } from "../../src/lib/antiFlood.js";
import { maxWarn } from "./warn.js";

const tg = (id, e) => `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;
const ID_ICON = tg("5422439311196834318", "🆔");
const NAME_ICON = tg("5411225014148014586", "📛");
const st = (v) => (v ? `${E.ok} Aktif` : `${E.no} Mati`);
const TYPE = { group: "Grup", supergroup: "Supergrup" };

export default {
  command: ["infogc"],
  category: "group",
  description: "Informasi lengkap grup: pemilik, jumlah admin/member, dan status semua fitur moderasi",
  groupOnly: true,
  run: async (ctx) => {
    const id = ctx.chat.id;
    const [chat, count, admins] = await Promise.all([
      ctx.telegram.getChat(id),
      ctx.telegram.getChatMembersCount(id).catch(() => "?"),
      ctx.telegram.getChatAdministrators(id).catch(() => []),
    ]);
    const owner = admins.find((a) => a.status === "creator");
    const humanAdmins = admins.filter((a) => !a.user.is_bot).length;
    const botAdmins = admins.length - humanAdmins;
    const g = getGroup(id);
    const warned = Object.values(g.warns || {}).filter((n) => n > 0).length;
    const filters = Object.keys(g.filters || {}).length;
    const flood = floodCfg(g.antiflood);
    const desc = chat.description ? esc(chat.description.length > 400 ? chat.description.slice(0, 400) + "…" : chat.description) : "";

    const info = table(["Info", "Detail"], [
      [`${NAME_ICON} Nama`, `<b>${esc(chat.title)}</b>`],
      [`${ID_ICON} ID`, `<code>${id}</code>`],
      [emo("🛡️ Tipe"), `${TYPE[chat.type] || esc(chat.type)} · ${chat.username ? `@${esc(chat.username)}` : "privat"}`],
      [emo("👑 Pemilik"), owner ? mention(owner.user.id, fullName(owner.user)) : "-"],
      [emo("🛡️ Admin"), `${humanAdmins}${botAdmins ? ` <i>(+${botAdmins} bot)</i>` : ""}`],
      [emo("👤 Member"), `<b>${count}</b>`],
    ]);

    const settings = table(["Fitur", "Status"], [
      ["Welcome", st(g.welcome)],
      ["Goodbye", st(g.goodbye)],
      ["Anti Link", st(g.antilink)],
      ["Anti Promosi", st(g.antipromosi)],
      ["Anti Forward", st(g.antiforward)],
      ["Anti Bot", st(g.antibot)],
      ["Anti Flood", flood.on ? `${E.ok} Aktif · ${flood.limit}/${flood.window}s` : `${E.no} Mati`],
    ]);

    const extra = table(["Lainnya", "Jumlah"], [
      [`${E.warn} Batas warn`, `<b>${maxWarn(g)}</b>`],
      [`${E.user} Member bertanda warn`, `<b>${warned}</b>`],
      [`${E.note} Filter kata kunci`, `<b>${filters}</b>`],
    ]);

    await richSay(
      ctx,
      title(E.info, "Info Grup") +
        info +
        (desc ? fold(`${E.note} Deskripsi`, desc) : "") +
        title(E.gear, "Pengaturan") +
        settings +
        extra +
        quote(`${E.info} Ubah pengaturan dengan <code>/antilink</code>, <code>/antiflood</code>, <code>/setwelcome</code>, dst.`)
    );
  },
};

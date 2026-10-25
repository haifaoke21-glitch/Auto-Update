import { getGroup } from "../../src/database.js";
import { replyView, title, table, quote, note, h } from "../../src/lib/richUi.js";
import { describeEntry } from "../../src/lib/filterCore.js";
import { E } from "../../src/lib/emo.js";

const PAGE_CHARS = 3000; // batas panjang HTML satu pesan (Telegram 4096)

export default {
  command: ["filters"],
  category: "group",
  description: "Lihat semua filter di grup ini (tampil sebagai Rich Message). Contoh: /filters",
  groupOnly: true,
  cooldown: 4000,
  run: async (ctx) => {
    const filters = getGroup(ctx.chat.id).filters || {};
    const keys = Object.keys(filters).sort((a, b) => a.localeCompare(b, "id"));

    if (!keys.length) {
      return replyView(ctx, note(E.info, "Belum ada filter", "Admin bisa menambahkan dengan <code>/filter kata teks</code> atau balas pesan lalu <code>/filter kata</code>."));
    }

    const rows = keys.map((k, i) => [String(i + 1), `<code>${h(k)}</code>`, h(describeEntry(filters[k]))]);

    // Bagi ke beberapa pesan kalau terlalu panjang
    const pages = [];
    let cur = [];
    let len = 0;
    for (const r of rows) {
      const l = r.join("").length + 40;
      if (cur.length && len + l > PAGE_CHARS) { pages.push(cur); cur = []; len = 0; }
      cur.push(r);
      len += l;
    }
    if (cur.length) pages.push(cur);

    for (let i = 0; i < pages.length; i++) {
      const last = i === pages.length - 1;
      const head = title(E.search, pages.length > 1 ? `Filter Grup (${i + 1}/${pages.length})` : "Filter Grup");
      const foot = last
        ? quote(
            `Total <b>${keys.length}</b> filter di <b>${h(ctx.chat.title || "grup ini")}</b>.`,
            "Tambah: <code>/filter kata</code> · Hapus: <code>/stop kata</code> · Hapus semua: <code>/stop</code>"
          )
        : "";
      await replyView(ctx, head + table(["No", "Kata kunci", "Jenis"], pages[i]) + foot);
    }
  },
};

import { isStaff, FLAT, MAX_SLOT } from "../../src/lib/cpanel/roles.js";
import { STAFF_DENY } from "../../src/lib/cpanel/util.js";
import { replyView, title, table, quote } from "../../src/lib/richUi.js";
import { E, emo } from "../../src/lib/emo.js";

// Daftar SEMUA role CPanel (tanpa daftar pemegang). Urutan = hierarki tinggi -> rendah.
const ROLES = [
  ["👑", "Owner Bot", "Akses penuh (config.js → ownerIds)"],
  ["👨‍💻", FLAT.developer.label, "Akses penuh fitur CPanel"],
  ["🔱", FLAT.root.label, "Akses penuh fitur CPanel"],
  ["🏛️", FLAT.founder.label, "Akses penuh fitur CPanel"],
  ["👑", FLAT.owner.label, "Akses penuh fitur CPanel"],
  ["💼", FLAT.ceo.label, "Kelola role di bawahnya"],
  ["🛡️", FLAT.tk.label, "Memberi role (Premium, Reseller, dll)"],
  ["🤝", FLAT.pt.label, "Memberi role (Premium, Reseller, dll)"],
  ["💎", "Premium", `Buat Admin Panel · versi V1–V${MAX_SLOT} per panel`],
  ["🛒", "Reseller", `Buat panel (1GB–Unli) · versi V1–V${MAX_SLOT} per panel`],
  ["☁️", FLAT.resvps.label, "Buat VPS DigitalOcean (CVPS)"],
  ["👤", "User", "Pengguna biasa"],
];

export default {
  command: ["listrole"],
  category: "add",
  roleCmd: true, // command role: hanya yang boleh memberi role, tidak tersedia di bot clone
  description: "Daftar semua role CPanel (Owner, Reseller, Reseller VPS, dll). Contoh: /listrole",
  cooldown: 4000,
  run: async (ctx) => {
    if (!isStaff(ctx.from.id)) return replyView(ctx, STAFF_DENY);
    const rows = ROLES.map(([icon, name, desc], i) => [String(i + 1), emo(`${icon} <b>${name}</b>`), desc]);
    return replyView(
      ctx,
      title('<tg-emoji emoji-id="6156436440260549720">🎖️</tg-emoji>', "Daftar Role CPanel") +
        table(["No", "Role", "Akses"], rows) +
        quote(`${E.info} Total <b>${ROLES.length}</b> role. Beri role: <code>/addrole</code> · Hapus: <code>/delrole</code> · Role kamu: <code>/info</code>`)
    );
  },
};

// Batasan fitur untuk bot clone (Jadi Bot).
// Kategori, plugin bertanda `roleCmd: true` (addrole/delrole/listrole), & tombol berikut hanya boleh dipakai lewat bot utama.

/** Kategori plugin yang diblokir di bot clone */
export const CLONE_BLOCKED_CATEGORIES = new Set(["cpanel", "cvps", "donasi"]);

/** Prefix callback inline-button milik fitur cpanel/cvps/addrole */
export const CLONE_BLOCKED_CALLBACKS = new Set([
  "cplimit", "clroff", "cpegg", "cph", // cpanel
  "cvps", "sdo", "lvps", "rbld", "dvps", // cvps
  "bmenu", // build menu (build apk & rename)
  "drole", "arole", // addrole
  "donate", // donasi
]);

export const CLONE_BLOCKED_TEXT = "🔒 Fitur CPanel, CVPS & Donasi hanya bisa dipakai lewat bot utama, tidak tersedia di bot clone.";

export const isCloneCtx = (ctx) => Boolean(ctx?.state?.isClone);

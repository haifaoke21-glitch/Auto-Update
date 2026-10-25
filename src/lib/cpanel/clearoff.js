// Logika bersama Clear Off: dipakai /clearoff (manual, ada konfirmasi) dan /autodelsrv (otomatis terjadwal).
import { listAll, clientApi, deleteServer, deleteUser } from "./ptero.js";
import { title, para, table } from "../richUi.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Slot panel yang sedang discan / dibersihkan (cegah proses ganda di panel yang sama) */
export const running = new Set();

/**
 * Scan panel: server OFFLINE + user (non-admin) yang akan ikut dihapus.
 * Mengembalikan { total, offline, users, unknown, skipped } atau { error }.
 */
export async function scanOffline(slot, onProgress) {
  const sv = await listAll(slot, "servers");
  if (!sv.ok) return { error: sv.error };
  const us = await listAll(slot, "users");
  if (!us.ok) return { error: us.error };

  const offline = [];
  let unknown = 0;
  let skipped = 0;
  for (let i = 0; i < sv.items.length; i++) {
    const s = sv.items[i];
    if (s.suspended) { skipped++; continue; } // server suspend tidak disentuh
    const r = await clientApi(slot, `/servers/${s.identifier || String(s.uuid).split("-")[0]}/resources`);
    if (!r.ok && r.status === 0) return { error: r.error }; // PLTC kosong / panel tidak terjangkau
    const state = r.ok ? r.data?.attributes?.current_state : null;
    if (state === "offline") offline.push({ id: s.id, name: s.name, user: s.user });
    else if (!state) unknown++; // status tidak terbaca -> JANGAN dianggap offline
    await sleep(300);
    if ((i + 1) % 25 === 0) await onProgress?.(i + 1, sv.items.length);
  }

  // User target: non-admin yang SEMUA servernya ada di daftar offline (atau memang tidak punya server)
  const offlineIds = new Set(offline.map((x) => x.id));
  const serversOf = new Map();
  for (const s of sv.items) {
    if (!serversOf.has(s.user)) serversOf.set(s.user, []);
    serversOf.get(s.user).push(s.id);
  }
  const users = [];
  for (const u of us.items) {
    if (u.root_admin) continue;
    const own = serversOf.get(u.id) || [];
    if (own.every((id) => offlineIds.has(id))) users.push({ id: u.id, username: u.username, serverIds: own });
  }
  return { total: sv.items.length, offline, users, unknown, skipped };
}

/** Hapus server offline lalu user tanpa server. Mengembalikan { srvOk, srvFail, usrOk, usrFail } */
export async function deleteOffline(slot, servers, users, onProgress) {
  const srvOk = [], srvFail = [], usrOk = [], usrFail = [];
  try {
    for (let i = 0; i < servers.length; i++) {
      const srv = servers[i];
      const r = await deleteServer(slot, srv.id);
      (r.status === 204 || r.status === 404 ? srvOk : srvFail).push(srv);
      if ((i + 1) % 10 === 0) await onProgress?.(`⏳ Menghapus server offline... ${i + 1}/${servers.length}`);
      await sleep(1000);
    }
    const deleted = new Set(srvOk.map((x) => x.id));
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      // user hanya dihapus bila semua servernya benar-benar sudah terhapus
      if (!u.serverIds.every((id) => deleted.has(id))) { usrFail.push(u); continue; }
      const r = await deleteUser(slot, u.id);
      (r.status === 204 || r.status === 404 ? usrOk : usrFail).push(u);
      if ((i + 1) % 10 === 0) await onProgress?.(`⏳ Menghapus user tanpa server... ${i + 1}/${users.length}`);
      await sleep(1000);
    }
  } catch (e) {
    console.error("[CLEAROFF]", e);
  }
  return { srvOk, srvFail, usrOk, usrFail };
}

export function reportHtml(titleText, panelName, { srvOk, srvFail, usrOk, usrFail }) {
  return (
    title("✓", titleText) +
    para(panelName) +
    table(["Kategori", "✓ Berhasil", "✕ Gagal"], [
      ["⬢ Server Offline", String(srvOk.length), String(srvFail.length)],
      ["◉ User Tanpa Server", String(usrOk.length), String(usrFail.length)],
    ])
  );
}

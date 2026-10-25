// Keluar dari proses supaya process manager menyalakan ulang bot (dipakai /restart dan /update).
// pm2 / systemd / docker : kode 0 cukup.
// Panel Pterodactyl     : kode 0 dianggap "berhenti normal" -> server hanya jadi OFFLINE dan TIDAK menyala lagi.
//                         Kode non-0 dianggap crash -> Crash Detection panel menyalakan ulang otomatis.
// Atur manual: config.js -> restartExitCode (angka). Kosong = otomatis (1 di Pterodactyl, 0 di tempat lain).
import config from "../../config.js";

export function restartExitCode() {
  const c = config.restartExitCode;
  if (Number.isInteger(c) && c >= 0 && c < 256) return c;
  return process.env.P_SERVER_UUID ? 1 : 0;
}

export function restartProcess(delayMs = 1000) {
  setTimeout(() => process.exit(restartExitCode()), delayMs);
}

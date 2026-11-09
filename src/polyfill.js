// Polyfill kompatibilitas Node 18 (global ini baru ada default di Node 20+).
// WAJIB di-import paling pertama di index.js supaya jalan sebelum modul lain (baileys dll) dimuat.
import { webcrypto } from "node:crypto";
import { File as NodeFile } from "node:buffer";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (typeof globalThis.File === "undefined" && NodeFile) globalThis.File = NodeFile;

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import fs from "fs";
import { EventEmitter } from "events";

export const DB_DIR = path.join(process.cwd(), "database");

// Event "new": dipancarkan saat user / grup / channel BARU tercatat (dipakai auto backup).
// payload: { type: "user" | "group" | "channel", id }
export const dbEvents = new EventEmitter();
export const emitNew = (type, id) => {
  try {
    dbEvents.emit("new", { type, id: String(id) });
  } catch (err) {
    console.error("[DB] listener error:", err.message);
  }
};

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function openDb(relPath, defaultData) {
  const file = path.join(DB_DIR, relPath);
  ensureDir(file);
  const adapter = new JSONFile(file);
  const db = new Low(adapter, defaultData);
  await db.read();
  db.data ||= defaultData;
  await db.write();
  return db;
}

// ===== Database utama =====
export const usersDb = await openDb("main/users.json", { users: {} });
export const groupsDb = await openDb("main/groups.json", { groups: {} });
export const settingsDb = await openDb("main/settings.json", { settings: {} });
export const ownerDb = await openDb("main/owner.json", { owner: [] });
export const partnerDb = await openDb("main/partner.json", { partner: [] });
export const premiumDb = await openDb("main/premium.json", { premium: [] });
export const statsDb = await openDb("main/stats.json", { totalCommand: 0, commands: {} });
// CFD: blacklist chat + channel tempat bot jadi admin (target broadcast)
export const fsubChatsDb = await openDb("main/fsubchats.json", { chats: {} }); // channel/grup tempat bot jadi admin (untuk /setfsub dengan link undangan privat)
export const cfdDb = await openDb("main/cfd.json", { blacklist: [], channels: {} });
cfdDb.data.blacklist ||= [];
cfdDb.data.channels ||= {};

// Pengingat sholat otomatis (/autosholat): chats { [chatId]: { enabled, query, place, tz, offset, threadId, sent: { date, keys }, by, at } }
export const sholatDb = await openDb("main/sholat.json", { chats: {} });
sholatDb.data.chats ||= {};
// global: saklar owner { enabled, query, place, tz, offset, by, at } — kalau enabled, semua user & grup otomatis ikut aktif
sholatDb.data.global ||= null;

// Jadi Bot: bot clone milik user premium ke atas ({ bots: { [ownerId]: { token, botId, username, createdAt } } })
export const jadibotDb = await openDb("main/jadibot.json", { bots: {} });
jadibotDb.data.bots ||= {};

// Donasi (/donate, /leaderboard): donors { [userId]: { name, username, anon, total, count, firstAt, lastAt } },
// history [{ id, uid, name, username, amount, anon, ts, fileId, status, channelMsgId }], counter
export const donateDb = await openDb("main/donations.json", { donors: {}, history: [], counter: 0 });
donateDb.data.donors ||= {};
donateDb.data.history ||= [];
donateDb.data.counter ||= 0;

// CPanel: role (flat + premium/reseller per versi panel) & konfigurasi panel Pterodactyl
// roles: { developer: [id], root: [], founder: [], owner: [], ceo: [], tk: [], pt: [], resvps: [] }
// prem / res: { "1": [id], "2": [id], ... "20": [id] }  (versi panel)
export const cpRolesDb = await openDb("main/cproles.json", { roles: {}, prem: {}, res: {}, last: {} });
cpRolesDb.data.roles ||= {};
cpRolesDb.data.prem ||= {};
cpRolesDb.data.res ||= {};
// last: { [userId]: [ { key, label, icon, servers: "all" | ["1","2"], at } ] } = riwayat role yang di-add, terbaru di depan (tampil di info /cpanel)
cpRolesDb.data.last ||= {};

// panels: { [slot]: { domain, plta, pltc } } ; settings: { panelres, paneladp, adp } ; limits/usage: limit request per role
export const cpanelDb = await openDb("main/cpanel.json", { panels: {}, active: "1", settings: {}, limits: {}, usage: {} });
cpanelDb.data.panels ||= {};
cpanelDb.data.settings ||= {};
cpanelDb.data.limits ||= {};
cpanelDb.data.usage ||= {};
cpanelDb.data.active ||= "1";
// Auto hapus server offline (/autodelsrv): { [slot]: { enabled, intervalMs, nextRunAt, chatId, warned, lastRunAt, lastResult } }
cpanelDb.data.autodel ||= {};
// CVPS (Create VPS DigitalOcean): API key per slot DO 1..10 -> { "1": { key, email, updatedAt }, ... }
cpanelDb.data.do ||= {};

// Semua database (path relatif -> instance). Dipakai auto backup.
export const allDbs = {
  "main/users.json": usersDb,
  "main/groups.json": groupsDb,
  "main/settings.json": settingsDb,
  "main/owner.json": ownerDb,
  "main/partner.json": partnerDb,
  "main/premium.json": premiumDb,
  "main/stats.json": statsDb,
  "main/cfd.json": cfdDb,
  "main/fsubchats.json": fsubChatsDb,
  "main/sholat.json": sholatDb,
  "main/jadibot.json": jadibotDb,
  "main/cproles.json": cpRolesDb,
  "main/cpanel.json": cpanelDb,
  "main/donations.json": donateDb,
};

// ===== Helper user =====
export function getUser(userId) {
  const id = String(userId);
  if (!usersDb.data.users[id]) {
    usersDb.data.users[id] = {
      id,
      name: "",
      registered: false,
      koin: 0,
      exp: 0,
      level: 1,
      joinedAt: Date.now(),
    };
    emitNew("user", id);
  }
  return usersDb.data.users[id];
}

export async function saveUser(userId, patch) {
  const user = getUser(userId);
  Object.assign(user, patch);
  await usersDb.write();
  return user;
}

// ===== Helper grup =====
export function getGroup(chatId) {
  const id = String(chatId);
  if (!groupsDb.data.groups[id]) {
    groupsDb.data.groups[id] = {
      id,
      welcome: true,
      goodbye: true,
      antilink: false,
      antipromosi: false,
      antiforward: false,
      antibot: false,
      antiadmin: false,
      antispam: false,
      modeketat: null, // { on, prev, at } — diatur oleh /modeketat (lihat src/lib/strictMode.js)
      muted: false,
      warns: {},
    };
    emitNew("group", id);
  }
  return groupsDb.data.groups[id];
}

export async function saveGroup(chatId, patch) {
  const group = getGroup(chatId);
  Object.assign(group, patch);
  await groupsDb.write();
  return group;
}

export async function bumpStats(commandName) {
  statsDb.data.totalCommand = (statsDb.data.totalCommand || 0) + 1;
  statsDb.data.commands[commandName] = (statsDb.data.commands[commandName] || 0) + 1;
  await statsDb.write();
}

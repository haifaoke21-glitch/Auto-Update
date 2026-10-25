// ════════════════════════════════════════════════════════════════════════
//  FITUR INSTALL PANEL PTERODACTYL (diport dari fitur_install_panel ke AzmiStecu-MD)
//
//  Entry point: tombol "🚀 Install Panel" di menu Home / Start (callback `menu:i:<uid>`).
//  Alur   : pilih paket -> IP VPS -> password root -> port SSH -> domain -> bot SSH ke VPS:
//           DNS Cloudflare -> swap otomatis -> installer Panel -> installer Wings ->
//           Location+Node -> config.yml -> API key PTLA/PTLC -> 1000 port (2000-2999) ->
//           import egg pilihan user (Node.js / Python / keduanya, dari data/eggs/*.json) -> kirim kartu hasil.
//
//  Pengaturan di config.js -> installPanel. Butuh package: axios, node-ssh, ssh2.
//
//  CATATAN: isi heredoc bash & kode Python di bawah SENGAJA berada di kolom 0
//  (jangan di-indent / di-format ulang, kalau tidak installer di VPS gagal).
// ════════════════════════════════════════════════════════════════════════
import fs from "fs";
import net from "net";
import path from "path";
import axios from "axios";
import * as nodeSshNs from "node-ssh";
import ssh2 from "ssh2";
import config from "../../config.js";
import { getUser } from "../database.js";
import { isOwner, allOwnerIds } from "../middleware.js";
import { registerCallback } from "./callbacks.js";

const NodeSSH = nodeSshNs.NodeSSH || nodeSshNs.default?.NodeSSH;
const PtSSHClient = ssh2.Client;

// ── Egg disimpan sebagai file JSON di data/eggs/ (satu file = satu egg) ──
const EGG_DIR = path.join(process.cwd(), "data", "eggs");
// Pilihan di wizard -> daftar file egg (tanpa .json) + label untuk tampilan
const EGG_CHOICES = {
  node:   { label: "Node.js",          files: ["nodejs"] },
  python: { label: "Python",           files: ["python"] },
  both:   { label: "Node.js + Python", files: ["nodejs", "python"] },
};
function loadEggFiles(keys) {
  const list = [];
  for (const k of keys) {
    try {
      list.push(JSON.parse(fs.readFileSync(path.join(EGG_DIR, `${k}.json`), "utf8")));
    } catch (e) {
      console.log(`[INSTALL PANEL] Gagal baca egg data/eggs/${k}.json: ${e.message}`);
    }
  }
  return list;
}

// ════════════════════════════════════════════════════════════════════════
//  MESIN INSTALLER (dibuat sekali, memakai telegram dari ctx pertama)
// ════════════════════════════════════════════════════════════════════════
function createCore(telegram) {
  const notifyOwners = async (text, extra = {}) => {
    for (const id of allOwnerIds()) {
      await telegram.sendMessage(id, text, extra).catch(() => {});
    }
  };


//  🚀 AUTO INSTALL PTERODACTYL PANEL — fitur baru
//  ────────────────────────────────────────────────────────────────
//  Ada 2 pintu masuk, keduanya jalan lewat mesin yang sama (ptInstallRun):
//
//  1) KATEGORI BERBAYAR "Install Sekali" / "Langganan" di Menu Layanan.
//     User input IP/Password/Port VPS miliknya sendiri secara manual.
//     Harga (config.installPanel.sekali/langganan.price) & daftar domain
//     yang bisa ditembak otomatis (config.installPanel.domains) diatur
//     di tempat_ganti.js.
//
//  2) SHORTCUT GRATIS di bawah data VPS, muncul setelah user beli VPS
//     dari bot ini sendiri. IP/Password/Port otomatis diambil dari
//     data_vps.json (dropletId sebagai kunci), user tinggal masukin domain.
//
//  Fitur: anti-domain-kembar, node domain auto-random, RAM di-hardcode,
//  auto node+egg+port, live-log (1 pesan yang terus di-edit).
// ════════════════════════════════════════════════════════════════

const PANEL_INSTALLS_DB = "./database/panel_installs.json";

function readPanelInstallsDB() {
  try {
    if (!fs.existsSync(PANEL_INSTALLS_DB)) return [];
    const d = JSON.parse(fs.readFileSync(PANEL_INSTALLS_DB, "utf8") || "[]");
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}
function savePanelInstallsDB(data) {
  try {
    fs.mkdirSync("./database", { recursive: true });
    fs.writeFileSync(PANEL_INSTALLS_DB, JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
}
function isInstallDomainTaken(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (!d) return false;
  return readPanelInstallsDB().some(r =>
    String(r.domain || "").toLowerCase() === d || String(r.nodeDomain || "").toLowerCase() === d
  );
}
function recordPanelInstall(rec) {
  const db = readPanelInstallsDB();
  db.push({ ...rec, createdAt: Date.now() });
  savePanelInstallsDB(db);
}

// ── Validasi IP (dipakai cuma untuk kategori berbayar, input manual user) ──
function ptIsValidIP(ip) {
  if (typeof ip !== "string") return false;
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip.trim());
}
function ptIsPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 18) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}
function ptIsPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) return ptIsPrivateIPv4(ip);
  return true; // fitur ini hanya dukung IPv4
}

// ── Domain helpers ──
function normalizeDomainInput(raw) {
  return String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
function isValidDomainFormat(d) {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d);
}
function getInstallPanelDomainEntry(fullDomain) {
  const domains = Array.isArray(config.installPanel?.domains) ? config.installPanel.domains : [];
  const fd = String(fullDomain || "").toLowerCase();
  return domains.find(d => {
    const root = String(d.domain || "").toLowerCase();
    return root && (fd === root || fd.endsWith("." + root));
  }) || null;
}
function guessDomainRoot(fullDomain) {
  const parts = String(fullDomain || "").split(".");
  return parts.length <= 2 ? fullDomain : parts.slice(-2).join(".");
}
function generateNodeDomain(panelDomain) {
  const d = normalizeDomainInput(panelDomain);
  const parts = d.split(".");
  if (parts.length >= 2) {
    const label = parts[0];
    const root = parts.slice(1).join(".");
    const candidate = `node-${label}.${root}`;
    if (!isInstallDomainTaken(candidate)) return candidate;
  }
  return `node-${Date.now().toString(36)}.${guessDomainRoot(d)}`;
}

// User cukup memasukkan satu nama/label domain, misalnya:
//   kenprivat-panelofficial
// lalu sistem otomatis menjadi:
//   kenprivat-panelofficial.my.id
function buildInstallPanelDomain(raw) {
  const suffix = normalizeDomainInput(config.installPanel?.domainSuffix || "my.id");
  const value = normalizeDomainInput(raw);
  if (!value) return null;

  // Jika user mengirim URL/domain lengkap, jangan menambahkan suffix dua kali.
  if (value.includes(".")) {
    return isValidDomainFormat(value) ? value : null;
  }

  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(value)) return null;
  if (!isValidDomainFormat(suffix)) return null;
  return `${value}.${suffix}`;
}
async function createInstallPanelDnsRecord(subdomain, ip) {
  const entry = getInstallPanelDomainEntry(subdomain);
  if (!entry || !entry.zone || !entry.apitoken) return false;
  const domainRoot = entry.domain;
  const prefix = subdomain === domainRoot ? "@" : subdomain.replace("." + domainRoot, "");
  const fullName = subdomain === domainRoot ? domainRoot : `${prefix}.${domainRoot}`;
  const headers = { Authorization: `Bearer ${entry.apitoken}`, "Content-Type": "application/json" };
  const base = `https://api.cloudflare.com/client/v4/zones/${entry.zone}/dns_records`;
  const body = { type: "A", name: fullName, content: ip, ttl: 1, proxied: false };
  try {
    // Cek dulu apakah record sudah ada -> update; kalau belum -> buat baru
    const listRes = await axios.get(`${base}?type=A&name=${encodeURIComponent(fullName)}`, { headers, timeout: 20000 });
    const existing = listRes.data?.result?.[0];
    if (existing) {
      const r = await axios.put(`${base}/${existing.id}`, body, { headers, timeout: 20000 });
      return !!r.data?.success;
    }
    const res = await axios.post(base, body, { headers, timeout: 20000 });
    return !!res.data?.success;
  } catch (e) {
    console.log("[PT-INSTALL DNS] error:", JSON.stringify(e.response?.data?.errors || e.response?.data || e.message));
    return false;
  }
}


function ptEsc(t) { return String(t ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Catatan: kolom memory/memory_overallocate di tabel `nodes` Pterodactyl bertipe
// INT (32-bit, maks 2.147.483.647). Jangan diisi angka lebih besar dari itu atau
// php artisan p:node:make akan gagal insert (Out of range value) dan Node ID
// gak ke-capture. 999999 MB (~977GB) udah cukup "unlimited" buat kebutuhan ini
// dan konsisten sama angka Disk yang sudah dipakai di bawah.
const PT_INSTALL_HARDCODED_RAM = "999999";

const PT_INSTALL_PREP_COMPOSER_CMD =
  "RAM_MB=$(free -m | awk '/^Mem:/{print $2}'); " +
  "SWAP_MB=$(free -m | awk '/^Swap:/{print $2}'); " +
  "if [ \"${SWAP_MB:-0}\" -lt 1024 ] && [ \"${RAM_MB:-0}\" -lt 2048 ] && [ ! -f /swapfile ]; then " +
  "fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null; " +
  "chmod 600 /swapfile; mkswap /swapfile >/dev/null 2>&1; swapon /swapfile >/dev/null 2>&1; " +
  "grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab; " +
  "fi; echo done";

const PT_INSTALLER_CMD =
  "export COMPOSER_MEMORY_LIMIT=-1; export COMPOSER_PROCESS_TIMEOUT=0; " +
  "export DEBIAN_FRONTEND=noninteractive; " +
  "bash <(curl -s https://pterodactyl-installer.se)";

function ptAttachWatchdog(stream, conn, chatId, label, onTimeout = null) {
  let lastData = Date.now();
  let nextNotifyAt = 4 * 60 * 1000;
  const HARD_TIMEOUT = 25 * 60 * 1000;
  const iv = setInterval(() => {
    const idle = Date.now() - lastData;
    if (idle >= HARD_TIMEOUT) {
      clearInterval(iv);
      try { if (typeof onTimeout === "function") onTimeout(label); } catch (_) {}
      stream._ptKilled = true;
      try { stream.signal("KILL"); } catch (_) {}
      try { conn.end(); } catch (_) {}
      return;
    }
    if (idle >= nextNotifyAt) {
      const mins = Math.floor(idle / 60000);
      nextNotifyAt += 4 * 60 * 1000;
    }
  }, 15000);
  stream.on("close", () => clearInterval(iv));
  stream.on("exit", () => clearInterval(iv));
  return () => { lastData = Date.now(); nextNotifyAt = 4 * 60 * 1000; };
}

function ptHandlePanelPrompts(data, stream, subdomain, adminUser, adminPass) {
  const s = data.toString();
  const sent = stream._ptSent || (stream._ptSent = {});
  if (s.includes("Input") && !sent.input) {
    sent.input = true;
    stream.write(`0\n\n\n1248\nAsia/Jakarta\n${adminUser}@gmail.com\n${adminUser}@gmail.com\n${adminUser}\n${adminUser}\n${adminUser}\n`);
    stream.write(`${adminPass}\n`);
    stream.write(`${subdomain}\n`);
    stream.write("y\ny\ny\ny\ny\n\n1\n");
  }
  if (s.includes("Select the appropriate number") && !sent.selectNumber) {
    sent.selectNumber = true;
    stream.write("1\n");
  }
  if (s.includes("Still assume SSL") && !sent.ssl) {
    sent.ssl = true;
    stream.write("y\n");
  }
  if (s.includes("Please read the Terms of Service") && !sent.tos) {
    sent.tos = true;
    stream.write("y\n");
  }
}
function ptHandleWingsPrompts(data, stream, domainnode, subdomain, adminUser) {
  const s = data.toString();
  const sent = stream._ptSent || (stream._ptSent = {});
  if (s.includes("Input") && !sent.input) {
    sent.input = true;
    stream.write("1\ny\ny\ny\n");
    stream.write(`${subdomain}\n`);
    stream.write(`y\n${adminUser}\n1248\ny\n`);
    stream.write(`${domainnode}\n`);
    stream.write(`y\n${adminUser}@gmail.com\ny\n`);
  }
  if (s.includes("automatically configure HTTPS using Let's Encrypt") && !sent.letsencrypt) {
    sent.letsencrypt = true;
    stream.write("y\n");
  }
}

// ── Inject 1000 allocation (port 2000-2999) langsung ke DB ──
async function ptInjectAutoPorts(ip, password, nodeId) {
  const ssh3 = new NodeSSH();
  try {
    await ssh3.connect({ host: ip, username: "root", password, readyTimeout: 30000 });
    const script = `
cat << 'PTINST_ALLOC_EOF' > /tmp/ptinst_alloc.php
<?php
require '/var/www/pterodactyl/vendor/autoload.php';
\$app = require_once '/var/www/pterodactyl/bootstrap/app.php';
\$kernel = \$app->make(Illuminate\\Contracts\\Console\\Kernel::class);
\$kernel->bootstrap();
try {
  \$rows = [];
  for (\$p = 2000; \$p <= 2999; \$p++) {
    \$rows[] = ['node_id' => ${nodeId}, 'ip' => '0.0.0.0', 'port' => \$p, 'ip_alias' => 'Auto Install', 'created_at' => now(), 'updated_at' => now()];
  }
  \\Illuminate\\Support\\Facades\\DB::table('allocations')->insertOrIgnore(\$rows);
  echo "ALLOC_OK=1";
} catch (\\Throwable \$e) {
  echo "ALLOC_ERROR=" . str_replace("\\n", " ", \$e->getMessage());
}
PTINST_ALLOC_EOF
cd /var/www/pterodactyl && php /tmp/ptinst_alloc.php
rm -f /tmp/ptinst_alloc.php
    `;
    const result = await ssh3.execCommand(script);
    ssh3.dispose();
    return /ALLOC_OK=1/.test(result.stdout);
  } catch (e) {
    console.log("[ptInjectAutoPorts] error:", e.message);
    try { ssh3.dispose(); } catch {}
    return false;
  }
}

// ── Import egg terpilih (dari data/eggs/*.json) lewat raw MySQL ──
async function ptImportCustomEggs(ip, password, eggKeys = ["nodejs"]) {
  const ssh2b = new NodeSSH();
  try {
    await ssh2b.connect({ host: ip, username: "root", password, readyTimeout: 30000 });
    const run = (cmd) => ssh2b.execCommand(cmd).then(r => (r.stdout + r.stderr).trim());

    const eggsData = loadEggFiles(eggKeys);
    if (!eggsData.length) { try { ssh2b.dispose(); } catch {} return false; }

    const eggsJson = JSON.stringify(eggsData);
    const eggsB64 = Buffer.from(eggsJson).toString("base64");

    const pyScript = `
import json, subprocess, os, uuid, sys, base64

eggs_b64 = "${eggsB64}"
eggs = json.loads(base64.b64decode(eggs_b64).decode())

env_file = None
for p in ['/var/www/pterodactyl/.env', '/var/www/panel/.env', '/opt/pterodactyl/.env']:
    if os.path.exists(p):
        env_file = p
        break

if not env_file:
    print('[EGG] ERROR: .env tidak ditemukan')
    sys.exit(1)

env = {}
with open(env_file) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

db = env.get('DB_DATABASE', '')
user = env.get('DB_USERNAME', '')
pw = env.get('DB_PASSWORD', '')

if not db:
    sys.exit(1)

def try_mysql(args, sql='SELECT 1;'):
    r = subprocess.run(['mysql'] + args + ['-sN', '-e', sql], capture_output=True, text=True)
    return r.returncode == 0

mc_args = None
for args in [['-u', 'root', db], ['-u', 'root', f'-p{pw}', db], ['-u', user, f'-p{pw}', db]]:
    if try_mysql(args):
        mc_args = args
        break

if not mc_args:
    print('[EGG] ERROR: tidak bisa koneksi MySQL')
    sys.exit(1)

def mysql(sql):
    r = subprocess.run(['mysql'] + mc_args + ['-e', sql], capture_output=True, text=True)
    return r.stdout.strip(), r.returncode

def mysql_val(sql):
    r = subprocess.run(['mysql'] + mc_args + ['-sN', '-e', sql], capture_output=True, text=True)
    return r.stdout.strip()

has_docker_image = mysql_val("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='eggs' AND COLUMN_NAME='docker_image';") == '1'

nest_uuid = str(uuid.uuid4())
mysql(f"INSERT IGNORE INTO nests (uuid,author,name,description,created_at,updated_at) VALUES('{nest_uuid}','autoinstall@bot.local','Auto Install Eggs','Auto Install',NOW(),NOW());")
nid = mysql_val("SELECT id FROM nests WHERE name='Auto Install Eggs' LIMIT 1;")

def esc(s):
    return str(s).replace("\\\\", "\\\\\\\\").replace("'", "\\\\'")

for egg in eggs:
    name = egg['name']
    exist = mysql_val(f"SELECT COUNT(*) FROM eggs WHERE name='{esc(name)}' AND nest_id={nid};")
    if exist == '0' or not exist:
        euuid = str(uuid.uuid4())
        if has_docker_image:
            cols = 'uuid,nest_id,author,name,description,docker_image,docker_images,startup,config_files,config_startup,config_logs,config_stop,script_install,script_entry,script_container,created_at,updated_at'
            vals = f"'{euuid}',{nid},'{esc(egg['author'])}','{esc(egg['name'])}','{esc(egg['desc'])}','{esc(egg['docker_image'])}','{esc(egg['docker_images'])}','{esc(egg['startup'])}','{esc(egg['config_files'])}','{esc(egg['config_startup'])}','{esc(egg.get('config_logs','{}'))}','{esc(egg['config_stop'])}','{esc(egg['script'])}','{esc(egg['entry'])}','{esc(egg['container'])}',NOW(),NOW()"
        else:
            cols = 'uuid,nest_id,author,name,description,docker_images,startup,config_files,config_startup,config_logs,config_stop,script_install,script_entry,script_container,created_at,updated_at'
            vals = f"'{euuid}',{nid},'{esc(egg['author'])}','{esc(egg['name'])}','{esc(egg['desc'])}','{esc(egg['docker_images'])}','{esc(egg['startup'])}','{esc(egg['config_files'])}','{esc(egg['config_startup'])}','{esc(egg.get('config_logs','{}'))}','{esc(egg['config_stop'])}','{esc(egg['script'])}','{esc(egg['entry'])}','{esc(egg['container'])}',NOW(),NOW()"
        mysql(f"INSERT IGNORE INTO eggs ({cols}) VALUES({vals});")
        egg_id = mysql_val(f"SELECT id FROM eggs WHERE name='{esc(name)}' AND nest_id={nid} LIMIT 1;")
        action = 'created'
    else:
        egg_id = mysql_val(f"SELECT id FROM eggs WHERE name='{esc(name)}' AND nest_id={nid} LIMIT 1;")
        if has_docker_image:
            mysql(f"UPDATE eggs SET author='{esc(egg['author'])}', description='{esc(egg['desc'])}', docker_image='{esc(egg['docker_image'])}', docker_images='{esc(egg['docker_images'])}', startup='{esc(egg['startup'])}', config_files='{esc(egg['config_files'])}', config_startup='{esc(egg['config_startup'])}', config_logs='{esc(egg.get('config_logs','{}'))}', config_stop='{esc(egg['config_stop'])}', script_install='{esc(egg['script'])}', script_entry='{esc(egg['entry'])}', script_container='{esc(egg['container'])}', updated_at=NOW() WHERE id={egg_id};")
        else:
            mysql(f"UPDATE eggs SET author='{esc(egg['author'])}', description='{esc(egg['desc'])}', docker_images='{esc(egg['docker_images'])}', startup='{esc(egg['startup'])}', config_files='{esc(egg['config_files'])}', config_startup='{esc(egg['config_startup'])}', config_logs='{esc(egg.get('config_logs','{}'))}', config_stop='{esc(egg['config_stop'])}', script_install='{esc(egg['script'])}', script_entry='{esc(egg['entry'])}', script_container='{esc(egg['container'])}', updated_at=NOW() WHERE id={egg_id};")
        mysql(f"DELETE FROM egg_variables WHERE egg_id={egg_id};")
        action = 'updated'

    if egg_id and 'variables' in egg:
        for v in egg['variables']:
            v_name = esc(v['name'])
            v_desc = esc(v.get('description',''))
            v_env = esc(v['env_variable'])
            v_def = esc(v['default_value'])
            v_rules = esc(v['rules'])
            v_uv = v['user_viewable']
            v_ue = v['user_editable']
            sql_var = f"INSERT IGNORE INTO egg_variables (egg_id, name, description, env_variable, default_value, user_viewable, user_editable, rules) VALUES ({egg_id}, '{v_name}', '{v_desc}', '{v_env}', '{v_def}', {v_uv}, {v_ue}, '{v_rules}');"
            mysql(sql_var)
    print(f'[EGG] {name} {action} with variables')

print('IMPORT_DONE')
`;

    const pyB64 = Buffer.from(pyScript).toString("base64");
    await run(`echo '${pyB64}' | base64 -d > /tmp/ptinst_egg.py`);
    const result = await run("python3 /tmp/ptinst_egg.py 2>&1");
    await run("rm -f /tmp/ptinst_egg.py");

    ssh2b.dispose();
    return result.includes("IMPORT_DONE");
  } catch (err) {
    console.log("[ptImportCustomEggs] error:", err.message);
    try { ssh2b.dispose(); } catch {}
    return false;
  }
}

// ── Kirim kartu hasil akhir install ke user ──
function ptFinishSuccess(chatId, info) {
  const {
    ip, password, domain, nodeDomain, adminUser, adminPass,
    ptla, ptlc, wingsStatus, nodeId, portResult, eggResult, eggLabel
  } = info;
  const wingsOk = wingsStatus === "active";
  const keyOk = ptla && ptlc;
  const keyBlock = keyOk
    ? `├ PTLA : <code>${ptEsc(ptla)}</code>\n└ PTLC : <code>${ptEsc(ptlc)}</code>`
    : `└ <tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>Gagal auto-generate</b> — buat manual lewat Admin → API`;

  const caption = `<blockquote>${wingsOk ? "<tg-emoji emoji-id=\"6327875261085783004\">🎉</tg-emoji>" : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>"} <b>𝗜𝗡𝗦𝗧𝗔𝗟𝗟 𝗣𝗔𝗡𝗘𝗟 ${wingsOk ? "𝗦𝗘𝗟𝗘𝗦𝗔𝗜" : "𝗦𝗘𝗟𝗘𝗦𝗔𝗜 — 𝗣𝗘𝗥𝗟𝗨 𝗗𝗜𝗖𝗘𝗞"}</b></blockquote>\n\n<blockquote><tg-emoji emoji-id="6073395072953485376">☁️</tg-emoji> <b>𝗩𝗣𝗦</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━\n├ IP       : <code>${ptEsc(ip)}</code>\n└ Password : <code>${ptEsc(password)}</code></blockquote>\n\n<blockquote><tg-emoji emoji-id="5282843764451195532">🖥️</tg-emoji> <b>𝗣𝗧𝗘𝗥𝗢𝗗𝗔𝗖𝗧𝗬𝗟</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━\n├ User     : <code>${ptEsc(adminUser)}</code>\n├ Pass     : <code>${ptEsc(adminPass)}</code>\n└ Domain   : ${ptEsc(domain)}</blockquote>\n\n<blockquote><tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> <b>𝗔𝗨𝗧𝗢 𝗦𝗘𝗧𝗨𝗣 — 𝗦𝗜𝗔𝗣 𝗗𝗜𝗣𝗔𝗞𝗔𝗜</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━\n├ Panel    : ${wingsOk ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji>" : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji>"}\n├ Wings    : ${wingsOk ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> Active" : "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> " + ptEsc(wingsStatus || "unknown")}\n├ Location : ${nodeId ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> Dibuat" : "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Gagal"}\n├ Node     : ${nodeId ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> ID " + ptEsc(nodeId) : "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Gagal"}\n├ Port     : ${portResult ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> 2000-2999 (1000 allocation)" : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Perlu dibuat manual"}\n└ Egg      : ${eggResult ? "<tg-emoji emoji-id=\"6120946172010959542\">✅</tg-emoji> " + ptEsc(eggLabel || "Egg") : "<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Perlu import manual"}</blockquote>\n\n<blockquote><tg-emoji emoji-id="5330115548900501467">🔑</tg-emoji> <b>𝗔𝗣𝗜 𝗞𝗘𝗬𝗦</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━\n${keyBlock}</blockquote>\n\n<blockquote><tg-emoji emoji-id="6129639980387015660">🚀</tg-emoji> <b>𝗦𝗘𝗥𝗩𝗘𝗥 𝗦𝗜𝗔𝗣 𝗗𝗜𝗕𝗨𝗔𝗧</b>\nSemua komponen dasar panel sudah otomatis disiapkan. User tinggal masuk ke panel, pilih <b>Create Server</b>, lalu pilih Node, Egg, dan Allocation.</blockquote>`;

  return telegram.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "𝗕𝘂𝗸𝗮 𝗣𝗮𝗻𝗲𝗹", icon_custom_emoji_id: "6129639980387015660", emoji_fallback: "🚀", url: `https://${domain}` }]] }
  });
}

// ── Tahap 3: Location + Node "Auto Install" + config + API key ──
function ptCreateNode(conn, chatId, subdomain, domainnode, ramvps, adminUser, adminPass, ipvps, passwd, state) {
  const { addLog } = state;
  addLog(`⚙️ Bikin Location & Node "Auto Install"...`);

  const shortTag = Date.now().toString(36).slice(-5);
  const locCmd = `
cd /var/www/pterodactyl

cat << 'PTINST_ID_EOF' > /tmp/ptinst_get_id.php
<?php
require '/var/www/pterodactyl/vendor/autoload.php';
\$app = require_once '/var/www/pterodactyl/bootstrap/app.php';
\$kernel = \$app->make(Illuminate\\Contracts\\Console\\Kernel::class);
\$kernel->bootstrap();
\$model = 'Pterodactyl\\\\Models\\\\' . \$argv[1];
echo \$model::orderBy('id', 'desc')->first()->id;
PTINST_ID_EOF

php artisan p:location:make << 'PTINST_LOC_EOF'
auto-install-${shortTag}
Auto Install
PTINST_LOC_EOF

PTINST_LOCATION_ID=$(php /tmp/ptinst_get_id.php Location)
echo "LOCATION_ID_CAPTURED=$PTINST_LOCATION_ID"

php artisan p:node:make << PTINST_NODE_EOF
Auto Install
Auto Install
$PTINST_LOCATION_ID
https
${domainnode}
yes
no
no
${ramvps}
${ramvps}
999999
999999
100
8080
2022
/var/lib/pterodactyl/volumes
PTINST_NODE_EOF

PTINST_NODE_ID=$(php /tmp/ptinst_get_id.php Node)
echo "NODE_ID_CAPTURED=$PTINST_NODE_ID"
rm -f /tmp/ptinst_get_id.php
  `;

  conn.exec(locCmd, (err, stream) => {
    if (err) { addLog(`❌ Gagal exec bikin location/node: ${err.message}`); return; }

    let locationId = null, nodeId = null;
    stream.on("data", (d) => {
      const out = d.toString();
      addLog(out);
      const locMatch = out.match(/LOCATION_ID_CAPTURED=(\d+)/);
      const nodeMatch = out.match(/NODE_ID_CAPTURED=(\d+)/);
      if (locMatch) locationId = locMatch[1];
      if (nodeMatch) nodeId = nodeMatch[1];
    });
    stream.stderr.on("data", () => {});

    stream.on("close", async () => {
      if (!nodeId) {
        addLog(`❌ Gagal bikin Node — Node ID gak ke-capture. Cek manual lewat panel.`);
        await telegram.sendMessage(chatId, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal bikin Location/Node "Auto Install". Cek panel manual, kemungkinan artisan p:location:make / p:node:make gagal.`, { parse_mode: "HTML" }).catch(() => {});
        conn.end();
        return;
      }
      addLog(`✅ Node "Auto Install" dibuat (Location ID: ${locationId}, Node ID: ${nodeId}).`);

      const cmd = `
cd /var/www/pterodactyl
php artisan p:node:configuration ${nodeId} > /etc/pterodactyl/config.yml 2>/tmp/ptinst_nodecfg_err.log
if [ $? -eq 0 ]; then echo "NODE_CFG_STATUS=ok"; else echo "NODE_CFG_STATUS=fail"; echo "NODE_CFG_ERR=$(tail -c 300 /tmp/ptinst_nodecfg_err.log | tr '\\n' ' ')"; fi
chmod 600 /etc/pterodactyl/config.yml 2>/dev/null
ufw allow 8080/tcp >/dev/null 2>&1; ufw allow 2022/tcp >/dev/null 2>&1
iptables -I INPUT -p tcp --dport 8080 -j ACCEPT >/dev/null 2>&1; iptables -I INPUT -p tcp --dport 2022 -j ACCEPT >/dev/null 2>&1
systemctl restart wings
sleep 3
echo "WINGS_STATUS=$(systemctl is-active wings)"
cat << 'EOF' > /tmp/ptinst_gen_keys.php
<?php
require '/var/www/pterodactyl/vendor/autoload.php';
\$app = require_once '/var/www/pterodactyl/bootstrap/app.php';
\$kernel = \$app->make(Illuminate\\Contracts\\Console\\Kernel::class);
\$kernel->bootstrap();
try {
  \$user = \\Pterodactyl\\Models\\User::where('username', '${adminUser}')->first();
  if (!\$user) \$user = \\Pterodactyl\\Models\\User::orderBy('id', 'asc')->first();
  if (!\$user) { echo "KEYGEN_ERROR=Tidak ada satupun user di panel ini\\n"; exit(1); }
  \$ptlaToken = \\Illuminate\\Support\\Str::random(40);
  \$ptlaId = \\Illuminate\\Support\\Str::random(16);
  \$ptlaKey = new \\Pterodactyl\\Models\\ApiKey();
  \$ptlaKey->user_id = \$user->id;
  \$ptlaKey->key_type = 1;
  \$ptlaKey->identifier = \$ptlaId;
  \$ptlaKey->token = encrypt(\$ptlaToken);
  \$ptlaKey->allowed_ips = [];
  \$ptlaKey->memo = 'Auto Install PTLA';
  \$ptlaKey->save();
  \$ptlcToken = \\Illuminate\\Support\\Str::random(40);
  \$ptlcId = \\Illuminate\\Support\\Str::random(16);
  \$ptlcKey = new \\Pterodactyl\\Models\\ApiKey();
  \$ptlcKey->user_id = \$user->id;
  \$ptlcKey->key_type = 2;
  \$ptlcKey->identifier = \$ptlcId;
  \$ptlcKey->token = encrypt(\$ptlcToken);
  \$ptlcKey->allowed_ips = [];
  \$ptlcKey->memo = 'Auto Install PTLC';
  \$ptlcKey->save();
  echo "PTLA_KEY=" . \$ptlaId . \$ptlaToken . "\\n";
  echo "PTLC_KEY=" . \$ptlcId . \$ptlcToken . "\\n";
} catch (\\Throwable \$e) {
  echo "KEYGEN_ERROR=" . str_replace("\\n", " ", \$e->getMessage()) . "\\n";
}
EOF
php /tmp/ptinst_gen_keys.php 2>>/tmp/ptinst_nodecfg_err.log
rm -f /tmp/ptinst_gen_keys.php
      `;

      conn.exec(cmd, async (err2, stream2) => {
        if (err2) {
          addLog(`❌ Gagal generate config / restart wings: ${err2.message}`);
          return;
        }
        let ptla = null, ptlc = null, wingsStatus = "unknown", keygenError = null;

        stream2.on("data", (d2) => {
          const out = d2.toString();
          const ptlaMatch = out.match(/PTLA_KEY=([a-zA-Z0-9]+)/);
          const ptlcMatch = out.match(/PTLC_KEY=([a-zA-Z0-9]+)/);
          if (ptlaMatch) ptla = ptlaMatch[1];
          if (ptlcMatch) ptlc = ptlcMatch[1];
          const wingsMatch = out.match(/WINGS_STATUS=(\S+)/);
          if (wingsMatch) wingsStatus = wingsMatch[1];
          const keygenErrMatch = out.match(/KEYGEN_ERROR=(.+)/);
          if (keygenErrMatch) keygenError = keygenErrMatch[1].trim();
        });
        stream2.stderr.on("data", () => {});

        stream2.on("close", async () => {
          if (keygenError) addLog(`⚠️ Generate PTLA/PTLC gagal: ${keygenError}`);
          else if (!ptla || !ptlc) addLog(`⚠️ PTLA/PTLC tidak ke-generate.`);
          addLog(`${ptla && ptlc ? "✅" : "⚠️"} Config node & API key ${ptla && ptlc ? "beres" : "sebagian gagal"} (Wings: ${wingsStatus}).`);

          addLog(`🔌 Inject auto port 2000-2999...`);
          const portResult = await ptInjectAutoPorts(ipvps, passwd, nodeId);
          addLog(`${portResult ? "✅" : "⚠️"} Auto port ${portResult ? "berhasil" : "gagal (bisa ditambah manual)"}.`);

          const eggLabel = state.eggLabel || "Node.js";
          addLog(`🥚 Import egg (${eggLabel})...`);
          const eggResult = await ptImportCustomEggs(ipvps, passwd, state.eggKeys);
          addLog(`${eggResult ? "✅" : "⚠️"} Import eggs ${eggResult ? "berhasil" : "gagal (bisa diimport manual)"}.`);

          await new Promise(r => setTimeout(r, 2000));
          addLog(`🎉 Semua proses selesai!`);

          recordPanelInstall({
            domain: subdomain,
            nodeDomain: domainnode,
            ip: ipvps,
            dropletId: state.dropletId || null,
            userId: state.userId,
            category: state.category,
            adminUser
          });
          
          await ptFinishSuccess(chatId, {
            ip: ipvps, password: passwd, domain: subdomain, nodeDomain: domainnode,
            adminUser, adminPass, ptla, ptlc, wingsStatus, nodeId, portResult, eggResult, eggLabel
          });
          try { if (typeof onSuccess === "function") await onSuccess({ domain: subdomain, nodeDomain: domainnode, adminUser, adminPass, ptla, ptlc, wingsStatus, nodeId, portResult, eggResult, eggLabel }); } catch (e) { console.error("[PT INSTALL onSuccess]", e); }
          try {
            await notifyOwners(
              `<blockquote><tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> <b>INSTALL PANEL SELESAI</b>\nUser: <code>${state.userId}</code>\nIP: <code>${ipvps}</code>\nDomain: ${ptEsc(subdomain)}\nKategori: ${ptEsc(state.category)}</blockquote>`,
              { parse_mode: "HTML" }
            );
          } catch (_) {}
          conn.end();
        });
      });
    });
  });
}

// ── Tahap 2: install Wings ──
function ptInstallWings(conn, chatId, subdomain, domainnode, ramvps, adminUser, adminPass, ipvps, passwd, state) {
  const { addLog } = state;
  addLog(`🚀 Menjalankan installer Wings...`);
  conn.exec(PT_INSTALLER_CMD, (err, stream) => {
    if (err) { addLog(`❌ Gagal exec installer wings: ${err.message}`); return; }
    const kick = ptAttachWatchdog(stream, conn, chatId, "Install Wings", (label) => state.setProgress(70, `${label} terlalu lama, proses dihentikan`));

    stream.on("close", () => {
      if (stream._ptKilled) return; // sudah dihentikan watchdog, jangan lanjut ke tahap berikutnya
      addLog(`✅ Install Wings selesai. Konfigurasi node...`);
      ptCreateNode(conn, chatId, subdomain, domainnode, ramvps, adminUser, adminPass, ipvps, passwd, state);
    });
    stream.on("data", (d) => {
      kick();
      addLog(d.toString());
      ptHandleWingsPrompts(d, stream, domainnode, subdomain, adminUser);
    });
    stream.stderr.on("data", () => kick());
  });
}

// ── Tahap 1 (entry point): DNS + install Panel ──
async function ptInstallRun(opts) {
  const {
    chatId, ip, password, port = 22, domain, userId,
    dropletId = null, category = "vps_bonus", onSuccess = null, eggChoice = "node"
  } = opts;
  const eggPick = EGG_CHOICES[eggChoice] || EGG_CHOICES.node;

  const domainEntry = getInstallPanelDomainEntry(domain);
  const nodeRoot = domainEntry ? domainEntry.domain : guessDomainRoot(domain);
  const nodeDomain = generateNodeDomain(domain);
  const ramvps = PT_INSTALL_HARDCODED_RAM;
  const adminUser = `admin${Math.floor(1000 + Math.random() * 9000)}`;
  const adminPass = `Auto${Math.floor(100 + Math.random() * 900)}${Math.random().toString(36).substring(2, 6)}!`;

  let progressMsgId = null;
  let progressPercent = 0;
  let progressLabel = "Menyiapkan instalasi...";
  let progressBusy = false;
  let progressQueued = false;

  const renderProgress = (force = false) => {
    if (progressBusy && !force) { progressQueued = true; return; }
    progressBusy = true;
    const filled = Math.round(progressPercent / 5);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);
    const text = (`<blockquote><tg-emoji emoji-id="6129639980387015660">🚀</tg-emoji> <b>Install Panel Pterodactyl</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${bar} <b>${progressPercent}%</b>\n\n<tg-emoji emoji-id="5341715473882955310">⚙️</tg-emoji> ${ptEsc(progressLabel)}\n<tg-emoji emoji-id="5447410659077661506">🌐</tg-emoji> <code>${ptEsc(domain)}</code></blockquote>`);
    const run = async () => {
      try {
        if (!progressMsgId) {
          const m = await telegram.sendMessage(chatId, text, { parse_mode: "HTML" });
          progressMsgId = m.message_id;
        } else {
          await telegram.editMessageText(chatId, progressMsgId, undefined, text, { parse_mode: "HTML" });
        }
      } catch (_) {}
      progressBusy = false;
      if (progressQueued) { progressQueued = false; setTimeout(() => renderProgress(true), 50); }
    };
    run();
  };

  const setProgress = (percent, label) => {
    const p = Math.max(progressPercent, Math.min(100, Number(percent) || 0));
    progressPercent = p;
    if (label) progressLabel = label;
    renderProgress();
  };

  const addLog = (line) => {
    const cleaned = String(line || "").replace(/\x1B\[[0-9;]*[mGKHFJA-Za-z]/g, "").trim();
    if (!cleaned) return;
    const l = cleaned.toLowerCase();
    if (l.includes("ssh connected")) setProgress(10, "Terhubung ke VPS");
    else if (l.includes("cek/siapin swap")) setProgress(15, "Menyiapkan VPS");
    else if (l.includes("menjalankan installer panel")) setProgress(25, "Menginstall panel");
    else if (l.includes("install panel selesai")) setProgress(50, "Panel selesai, menyiapkan Wings");
    else if (l.includes("menjalankan installer wings")) setProgress(55, "Menginstall Wings");
    else if (l.includes("install wings selesai")) setProgress(70, "Wings selesai, membuat node");
    else if (l.includes("bikin location") || l.includes("node \"auto install\" dibuat")) setProgress(78, "Membuat node");
    else if (l.includes("config node & api key")) setProgress(85, "Mengonfigurasi node");
    else if (l.includes("inject auto port")) setProgress(90, "Menyiapkan port");
    else if (l.includes("import egg")) setProgress(95, "Menyiapkan egg");
    else if (l.includes("semua proses selesai")) setProgress(100, "Install selesai");
    else if (l.includes("gagal") || l.includes("error")) renderProgress();
  };

  setProgress(3, "Menyiapkan DNS");
  const dnsPanelOk = await createInstallPanelDnsRecord(domain, ip);
  const dnsNodeOk = await createInstallPanelDnsRecord(nodeDomain, ip);
  if (dnsPanelOk && dnsNodeOk) setProgress(8, "DNS berhasil disiapkan");
  else setProgress(8, "DNS sebagian gagal, melanjutkan instalasi");

  renderProgress(true);

  const state = { addLog, setProgress, userId, dropletId, category, eggKeys: eggPick.files, eggLabel: eggPick.label };

  const conn = new PtSSHClient();
  conn
    .on("ready", () => {
      addLog(`✅ SSH connected ke ${ip}`);
      addLog(`⚙️ Cek/siapin swap dulu (jaga-jaga RAM kecil)...`);

      conn.exec(PT_INSTALL_PREP_COMPOSER_CMD, (prepErr, prepStream) => {
        const runPanelInstaller = () => {
          addLog(`🚀 Menjalankan installer Panel (bisa idle lama pas composer install, tenang aja dipantau)...`);
          conn.exec(PT_INSTALLER_CMD, (err, stream) => {
            if (err) { setProgress(progressPercent, `Install gagal: ${String(err.message || err).slice(0, 160)}`); try { conn.end(); } catch (_) {} return; }
            const kick = ptAttachWatchdog(stream, conn, chatId, "Install Panel", (label) => setProgress(progressPercent, `${label} terlalu lama, proses dihentikan`));

            stream.on("close", () => {
              if (stream._ptKilled) return; // sudah dihentikan watchdog, jangan lanjut ke tahap berikutnya
              addLog(`✅ Install Panel selesai. Lanjut Wings...`);
              ptInstallWings(conn, chatId, domain, nodeDomain, ramvps, adminUser, adminPass, ip, password, state);
            });
            stream.on("data", (d) => {
              kick();
              addLog(d.toString());
              ptHandlePanelPrompts(d, stream, domain, adminUser, adminPass);
            });
            stream.stderr.on("data", () => kick());
          });
        };
        if (prepErr || !prepStream) {
          addLog(`⚠️ Gagal prep swap (${prepErr?.message || "unknown"}), lanjut install tanpa swap tambahan.`);
          return runPanelInstaller();
        }
        prepStream.on("close", runPanelInstaller);
        prepStream.on("data", () => {});
        prepStream.stderr && prepStream.stderr.on("data", () => {});
      });
    })
    .on("error", async (e) => {
      progressLabel = `Install gagal: ${String(e?.message || e).slice(0, 180)}`;
      renderProgress(true);
      setProgress(progressPercent, progressLabel);
    })
    .connect({ host: ip, port: Number(port) || 22, username: "root", password });
}


return {
  ptInstallRun, ptIsValidIP, ptIsPrivateOrReservedIp, normalizeDomainInput,
  isValidDomainFormat, isInstallDomainTaken, buildInstallPanelDomain, ptEsc,
};
}

let core = null;
const getCore = (telegram) => (core ||= createCore(telegram));

// ════════════════════════════════════════════════════════════════════════
//  UI: menu, wizard IP/Password/Port/Domain, tombol
// ════════════════════════════════════════════════════════════════════════
const WIZARD_TTL = 15 * 60 * 1000; // wizard kedaluwarsa 15 menit sejak langkah terakhir
const wizard = new Map(); // userId -> { step, category, ip, password, port, expires, chatId }
const lastRun = new Map(); // userId -> timestamp install terakhir (cooldown)

const HTML = { parse_mode: "HTML", disable_web_page_preview: true };
const cfgOf = () => config.installPanel || {};
const cooldownMs = () => Math.max(Number(cfgOf().cooldownMinutes ?? 10), 0) * 60 * 1000;
const isPrivate = (ctx) => ctx.chat?.type === "private";

const BACK_ROW = (uid) => [
  { text: "Kembali", icon_custom_emoji_id: "6206505206197261313", emoji_fallback: "🔙", icon_custom_emoji_id: "5352759161945867747", emoji_fallback: "🔙", callback_data: `menu:s:${uid}` },
  { text: "Tutup", icon_custom_emoji_id: "6206110936789423908", emoji_fallback: "✖️", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "✖️", callback_data: `menu:x:${uid}` },
];

/** Edit pesan menu jadi tampilan baru; kalau tidak bisa diedit (foto/rich), hapus lalu kirim baru */
async function editOrSend(ctx, text, reply_markup) {
  const msg = ctx.callbackQuery?.message;
  if (msg) {
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup });
      return;
    } catch (e) {
      if (/message is not modified/i.test(e?.message || "")) return;
    }
    await ctx.deleteMessage().catch(() => {});
  }
  return ctx.reply(text, { ...HTML, reply_markup });
}

const cancelMarkup = () => ({ inline_keyboard: [[{ text: "Batalkan", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: "ipanel:cancel" }]] });

/** Tampilan menu Install Panel (dipanggil dari tombol di menu Home / Start) */
export async function showInstallMenu(ctx) {
  if (!isPrivate(ctx)) {
    return ctx.answerCbQuery("🔒 Fitur Install Panel hanya bisa dipakai di chat pribadi bot (menyangkut password VPS).", { show_alert: true });
  }
  const cfg = cfgOf();
  const sekali = cfg.sekali || {};
  const langganan = cfg.langganan || {};
  const uid = ctx.from.id;
  await editOrSend(
    ctx,
    `<blockquote><tg-emoji emoji-id="6129639980387015660">🚀</tg-emoji> <b>Install Panel Pterodactyl GRATIS</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Pilih jenis instalasi. <b>Tidak ada pembayaran atau potongan koin.</b>\n` +
      `Fitur ini tersedia gratis untuk semua user.</blockquote>`,
    {
      inline_keyboard: [
        [
          { text: `${sekali.name || "Install Sekali"} · GRATIS`, icon_custom_emoji_id: "6095843123252957701", emoji_fallback: "⚡", callback_data: "ipanel:pick:sekali" },
          { text: `${langganan.name || "Unlimited"} · GRATIS`, icon_custom_emoji_id: "6123129707614441341", emoji_fallback: "♾️", callback_data: "ipanel:pick:langganan" },
        ],
        BACK_ROW(uid),
      ],
    }
  );
  return ctx.answerCbQuery().catch(() => {});
}

registerCallback("ipanel", async (ctx, args) => {
  const action = args[0];
  if (!isPrivate(ctx)) {
    return ctx.answerCbQuery("🔒 Hanya bisa di chat pribadi bot.", { show_alert: true });
  }
  const userId = ctx.from.id;

  if (action === "pick") {
    const category = args[1] === "langganan" ? "langganan" : "sekali";
    const cfg = cfgOf()[category] || {};
    const cd = cooldownMs();
    const left = (lastRun.get(String(userId)) || 0) + cd - Date.now();
    if (!isOwner(userId) && cd > 0 && left > 0) {
      return ctx.answerCbQuery(`⏳ Tunggu ${Math.ceil(left / 60000)} menit lagi sebelum install berikutnya.`, { show_alert: true });
    }
    wizard.set(String(userId), {
      step: "IP",
      category,
      itemName: `Install Panel Pterodactyl ${cfg.name || category}`,
      expires: Date.now() + WIZARD_TTL,
    });
    await ctx.answerCbQuery("✅ Install Panel GRATIS").catch(() => {});
    return editOrSend(
      ctx,
      `<blockquote><tg-emoji emoji-id="6327875261085783004">🆓</tg-emoji> <b>Install Panel GRATIS</b>\n\n` +
        `<tg-emoji emoji-id="5319109106793986870">📦</tg-emoji> <b>Paket:</b> ${getCore(ctx.telegram).ptEsc(cfg.name || category)}\n` +
        `<tg-emoji emoji-id="6202001327397020033">💳</tg-emoji> <b>Biaya:</b> GRATIS\n\n` +
        `Sekarang masukkan <b>IP VPS</b> yang ingin di-install.\n` +
        `<i>Contoh: 159.65.137.2</i></blockquote>`,
      cancelMarkup()
    );
  }

  if (action === "egg") {
    const st = wizard.get(String(userId));
    if (!st || st.step !== "EGG" || !st.domain) {
      return ctx.answerCbQuery("❌ Sesi habis. Mulai lagi dari menu Install Panel.", { show_alert: true });
    }
    const eggChoice = EGG_CHOICES[args[1]] ? args[1] : "node";
    const { ip, password, port, category, itemName, domain } = st;
    wizard.delete(String(userId));
    lastRun.set(String(userId), Date.now());
    await ctx.answerCbQuery(`✅ Egg: ${EGG_CHOICES[eggChoice].label}`).catch(() => {});
    // Hapus pesan pilihan egg supaya tidak diklik dua kali
    await ctx.deleteMessage().catch(() => {});

    const c = getCore(ctx.telegram);
    const chatId = ctx.chat?.id || userId;
    c.ptInstallRun({
      chatId, ip, password, port, domain, userId, dropletId: null,
      category, paymentMethod: "GRATIS", itemName, amount: 0, eggChoice,
    }).catch((err) => {
      console.error("[INSTALL PANEL]", err);
      ctx.telegram.sendMessage(chatId, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Install gagal: ${c.ptEsc(err?.message || err)}`, { parse_mode: "HTML" }).catch(() => {});
    });
    return;
  }

  if (action === "cancel") {
    if (!wizard.has(String(userId))) {
      return ctx.answerCbQuery("❌ Tidak ada proses install aktif.", { show_alert: true });
    }
    wizard.delete(String(userId));
    await ctx.answerCbQuery("Dibatalkan.").catch(() => {});
    return editOrSend(ctx, "<blockquote><tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> <b>Proses install dibatalkan.</b></blockquote>", {
      inline_keyboard: [BACK_ROW(userId)],
    });
  }
  return ctx.answerCbQuery();
});

/** Handler teks untuk wizard. Pasang di index.js SEBELUM messageHandler. */
export async function installPanelTextHandler(ctx, next) {
  const userId = String(ctx.from?.id || "");
  const st = wizard.get(userId);
  if (!st || !isPrivate(ctx)) return next();

  if (st.expires < Date.now()) {
    wizard.delete(userId);
    return next();
  }
  const text = String(ctx.message?.text || "").trim();
  // Perintah bot (mis. /menu) tetap berjalan normal, wizard tidak mengganggu
  if (/^\/[a-z0-9_]+(@\w+)?(\s|$)/i.test(text)) return next();
  if (getUser(ctx.from.id).banned && !isOwner(ctx.from.id)) return;

  const c = getCore(ctx.telegram);
  const reply = (t, extra = {}) => ctx.reply(t, { ...HTML, reply_markup: cancelMarkup(), ...extra });
  st.expires = Date.now() + WIZARD_TTL;

  if (st.step === "IP") {
    if (!c.ptIsValidIP(text)) {
      return reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> <b>Format IP tidak valid.</b>\nContoh: 123.45.67.89\n\nCoba lagi, masukkan IP VPS:");
    }
    if (c.ptIsPrivateOrReservedIp(text)) {
      return reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> <b>IP itu private/reserved</b> (bukan IP publik), gak bisa dipakai.\n\nCoba lagi, masukkan IP VPS publik:");
    }
    st.ip = text;
    st.step = "PASSWORD";
    return reply("<tg-emoji emoji-id=\"5395444784611480792\">✏️</tg-emoji> Masukkan <b>Password VPS</b> (root):\n<i>Pesan password akan otomatis dihapus dari chat.</i>");
  }

  if (st.step === "PASSWORD") {
    if (!text) return reply("⚠️ Password tidak boleh kosong. Coba lagi:");
    st.password = text;
    st.step = "PORT";
    ctx.deleteMessage().catch(() => {}); // jangan biarkan password nongol di chat
    return reply('<tg-emoji emoji-id="5222079954421818267">🔌</tg-emoji> Masukkan <b>Port SSH</b> VPS:\n<i>Ketik angka porinya, atau ketik "default" untuk pakai port 22.</i>');
  }

  if (st.step === "PORT") {
    const raw = text.toLowerCase();
    let port = 22;
    if (raw !== "default" && raw !== "skip") {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        return reply('⚠️ Port tidak valid. Ketik angka port (1-65535) atau "default":');
      }
      port = parsed;
    }
    st.port = port;
    st.step = "DOMAIN";
    return reply("<tg-emoji emoji-id=\"5447410659077661506\">🌐</tg-emoji> Masukkan <b>domain panel</b>:\n<i>Contoh: panel.kasonova.web.id</i>");
  }

  if (st.step === "DOMAIN") {
    // Domain lengkap dipakai apa adanya; kalau hanya label (tanpa titik) dan domainSuffix diisi di config -> label + suffix
    let domain = c.normalizeDomainInput(text);
    if (domain && !domain.includes(".") && cfgOf().domainSuffix) domain = c.buildInstallPanelDomain(domain) || domain;
    if (!c.isValidDomainFormat(domain)) {
      return reply("⚠️ Format domain tidak valid.\nContoh: panel.kasonova.web.id\n\nMasukkan lagi domainnya:");
    }
    if (c.isInstallDomainTaken(domain)) {
      return reply("<tg-emoji emoji-id=\"5240241223632954241\">🚫</tg-emoji> <b>Domain ini sudah dipakai</b> untuk instalasi lain.\n\nSilakan masukkan domain lain:");
    }
    // Domain valid -> lanjut pilih egg lewat tombol (install baru jalan setelah pilih)
    st.domain = domain;
    st.step = "EGG";
    return ctx.reply(
      `<blockquote><tg-emoji emoji-id="5264919878082509254">🥚</tg-emoji> <b>Pilih Egg</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<tg-emoji emoji-id="5447410659077661506">🌐</tg-emoji> <b>Domain:</b> <code>${c.ptEsc(domain)}</code>\n\n` +
        `Egg apa yang mau dipasang di panel?</blockquote>`,
      {
        ...HTML,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Node.js", icon_custom_emoji_id: "6120946172010959542", emoji_fallback: "🟩", callback_data: "ipanel:egg:node" },
              { text: "Python", icon_custom_emoji_id: "5316881354502192070", emoji_fallback: "🐍", callback_data: "ipanel:egg:python" },
            ],
            [{ text: "Keduanya (Node.js + Python)", icon_custom_emoji_id: "6123129707614441341", emoji_fallback: "✨", callback_data: "ipanel:egg:both" }],
            [{ text: "Batalkan", icon_custom_emoji_id: "5210952531676504517", emoji_fallback: "❌", callback_data: "ipanel:cancel" }],
          ],
        },
      }
    );
  }

  return next();
}

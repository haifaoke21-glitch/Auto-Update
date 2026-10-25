import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";

const PLUGINS_DIR = path.join(process.cwd(), "plugins");

// pluginStore: Map<commandName, pluginModule>
export const pluginStore = new Map();
export const pluginList = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

/**
 * Setiap file plugin harus punya default export berbentuk:
 * {
 *   command: ["menu", "help"],       // array alias command (tanpa prefix)
 *   category: "main",                // nama kategori (untuk /menu)
 *   description: "Menampilkan menu", // deskripsi singkat
 *   ownerOnly: false,
 *   adminOnly: false,
 *   groupOnly: false,
 *   privateOnly: false,
 *   run: async (ctx, { args, text }) => { ... }
 * }
 */
export async function loadPlugins() {
  pluginStore.clear();
  pluginList.length = 0;

  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log(chalk.yellow("[PLUGIN] Folder plugins/ tidak ditemukan."));
    return;
  }

  const files = walk(PLUGINS_DIR);
  let loaded = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href + `?update=${Date.now()}`);
      const plugin = mod.default;
      if (!plugin || !plugin.command || !plugin.run) {
        console.log(chalk.yellow(`[PLUGIN] Lewati (format tidak valid): ${file}`));
        continue;
      }
      // hiddenCommands = alias yang tetap aktif tapi tidak ditampilkan di menu (mis. versi panel V2..V20)
      const commands = [
        ...(Array.isArray(plugin.command) ? plugin.command : [plugin.command]),
        ...(plugin.hiddenCommands || []),
      ];
      plugin._file = file;
      pluginList.push(plugin);
      for (const cmd of commands) {
        pluginStore.set(cmd.toLowerCase(), plugin);
      }
      loaded++;
    } catch (err) {
      failed++;
      console.log(chalk.red(`[PLUGIN] Gagal load ${file}: ${err.message}`));
    }
  }

  console.log(
    chalk.green(`[PLUGIN] ${loaded} plugin dimuat`) +
      (failed ? chalk.red(`, ${failed} gagal`) : "")
  );
}

export function getPlugin(commandName) {
  return pluginStore.get(commandName.toLowerCase());
}

export function getPluginsByCategory() {
  const grouped = {};
  for (const plugin of pluginList) {
    const cat = plugin.category || "lainnya";
    grouped[cat] ||= [];
    grouped[cat].push(plugin);
  }
  return grouped;
}

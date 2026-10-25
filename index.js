import "./src/polyfill.js";
import { Telegraf } from "telegraf";
import chalk from "chalk";
import config from "./config.js";
import { allOwnerIds } from "./src/middleware.js";
import { loadPlugins } from "./src/pluginLoader.js";
import { checkChannelsAtStartup } from "./src/lib/forceJoin.js";
import { initBackup, flushBackup } from "./src/lib/backup.js";
import { registerHandlers } from "./src/lib/botSetup.js";
import { restoreSenders } from "./src/lib/whatsappSender.js";
import { startAutoDelSrv } from "./src/lib/cpanel/autodel.js";
import { startSholatReminder } from "./src/lib/sholatReminder.js";
import { startLockScheduler } from "./src/lib/groupLock.js";
import { telegrafOptions, withRetry } from "./src/lib/net.js";
import { setMainBot, setHandlerRegistrar, restoreClones, stopAllClones } from "./src/lib/jadibot.js";

if (!config.botToken || config.botToken === "isi_token_botfather_disini") {
  console.error(
    chalk.red(
      "[FATAL] botToken belum diisi. Buka config.js lalu isi token dari @BotFather."
    )
  );
  process.exit(1);
}

const bot = new Telegraf(config.botToken, await telegrafOptions());
const fatal = (err) => {
  console.error(chalk.red("[FATAL] Gagal start bot:"), err);
  process.exit(1);
};

async function start() {
  await restoreSenders();
  await loadPlugins();

  registerHandlers(bot);

  bot.catch((err, ctx) => {
    console.error(chalk.red(`[BOT ERROR] ${ctx.updateType}:`), err);
  });

  const me = await withRetry(() => bot.telegram.getMe(), { label: "getMe" });
  setMainBot(bot, me);
  setHandlerRegistrar(registerHandlers);

  // Auto backup database tiap ada user / grup / channel baru (config.js -> backup)
  initBackup(bot.telegram);

  // Auto hapus server offline terjadwal (/autodelsrv on|off)
  startAutoDelSrv(bot.telegram);

  // Pengingat sholat otomatis (/autosholat on|off, khusus owner, global)
  startSholatReminder(bot.telegram);

  // Timer /lockall: buka grup otomatis saat waktunya habis
  startLockScheduler(bot.telegram);

  // Cek channel wajib join (config.js -> forceJoin)
  const fj = await checkChannelsAtStartup(bot.telegram, me.id);
  if (fj.enabled && !fj.configured) {
    console.log(chalk.yellow("[FORCEJOIN] Username channel masih default. Isi forceJoin.channels di config.js agar wajib join aktif."));
  }
  for (const r of fj.report || []) {
    if (!r.ok) console.log(chalk.yellow(`[FORCEJOIN] ${r.channel}: ${r.note}`));
  }

  // Di Telegraf 4.x promise bot.launch() baru selesai saat bot berhenti, jadi tidak di-await.
  // Kegagalan awal (mis. token dipakai instance lain) tetap tertangkap lewat race ini.
  const launching = bot.launch({
    // chat_member & message_reaction tidak dikirim Telegram kecuali diminta; dipakai untuk melengkapi daftar /tagall
    allowedUpdates: ["message", "edited_message", "channel_post", "callback_query", "my_chat_member", "chat_member", "message_reaction", "chat_join_request"],
  });
  await Promise.race([launching, new Promise((r) => setTimeout(r, 1500))]);
  launching.catch(fatal);

  restoreClones().catch((e) => console.warn("[JADIBOT] restore gagal:", e.message)); // jalankan ulang bot clone tersimpan

  console.log(chalk.green(`✅ ${config.botName} aktif sebagai @${me.username}`));
  console.log(chalk.cyan(`   Prefix: ${config.prefix}  |  Owner: ${allOwnerIds().join(", ") || "(belum diset)"}`));
  if (fj.configured) console.log(chalk.cyan(`   Wajib join: ${fj.report.map((r) => r.channel).join(", ")}`));
}

start().catch(fatal);

// Saat dimatikan, kirim dulu backup yang masih menunggu (maks. 8 detik)
const shutdown = (sig) => { stopAllClones(sig); return flushBackup().catch(() => {}).finally(() => bot.stop(sig)); };
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

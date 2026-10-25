import config from "../config.js";
import { getPlugin } from "./pluginLoader.js";
import { getUser, saveUser, bumpStats, getGroup } from "./database.js";
import { isOwner, isGroupAdmin, checkCooldown } from "./middleware.js";
import { requireJoin } from "./lib/forceJoin.js";
import { withLoading } from "./lib/loading.js";
import { getCost, spend, runPaid } from "./lib/coin.js";
import { CLONE_BLOCKED_CATEGORIES, CLONE_BLOCKED_TEXT, isCloneCtx } from "./lib/cloneGuard.js";
import { escH } from "./lib/util.js";
import { isAdminFast } from "./lib/adminCache.js";
import { PROMO_LINKS, collectText } from "./lib/groupGuard.js";
import { mention, fullName, fmtDuration } from "./lib/groupUtil.js";
import { isStrict, strictMute, STRICT_MUTE_SEC } from "./lib/strictMode.js";

function allPrefixes() {
  return [config.prefix, ...(config.altPrefixes || [])].filter(Boolean);
}

function parseCommand(messageText) {
  if (!messageText) return null;
  const prefixes = allPrefixes();
  let body = null;

  for (const p of prefixes) {
    if (messageText.startsWith(p)) {
      body = messageText.slice(p.length);
      break;
    }
  }
  // Telegram juga native "/command@botusername"
  if (body === null && messageText.startsWith("/")) {
    body = messageText.slice(1);
  }
  if (body === null) return null;

  const [rawCmd, ...rest] = body.trim().split(/\s+/);
  if (!rawCmd) return null;
  const command = rawCmd.split("@")[0].toLowerCase();
  const args = rest;
  const text = args.join(" ");
  return { command, args, text };
}

export async function messageHandler(ctx, next) {
  try {
    const messageText = ctx.message?.text || ctx.message?.caption || "";
    const parsed = parseCommand(messageText);
    if (!parsed) return next?.();

    const plugin = getPlugin(parsed.command);
    if (!plugin) return next?.();

    // Bot clone (Jadi Bot) tidak boleh memakai fitur cpanel / cvps
    if (isCloneCtx(ctx) && (CLONE_BLOCKED_CATEGORIES.has(plugin.category) || plugin.roleCmd)) {
      return ctx.reply(CLONE_BLOCKED_TEXT);
    }

    // Guard dasar
    if (plugin.groupOnly && ctx.chat.type === "private") {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini hanya untuk grup.", { parse_mode: "HTML" });
    }
    if (plugin.privateOnly && ctx.chat.type !== "private") {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini hanya untuk chat pribadi.", { parse_mode: "HTML" });
    }
    if (plugin.ownerOnly && !isOwner(ctx.from.id)) {
      return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini khusus owner bot.", { parse_mode: "HTML" });
    }
    if (plugin.adminOnly && ctx.chat.type !== "private") {
      const admin = (await isGroupAdmin(ctx)) || isOwner(ctx.from.id);
      if (!admin) return ctx.reply("<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Perintah ini khusus admin grup.", { parse_mode: "HTML" });
    }

    // User dibanned: diamkan saja
    const user = getUser(ctx.from.id);
    if (user.banned && !isOwner(ctx.from.id)) return;

    // Wajib join channel (config.js -> forceJoin). Dicek SEBELUM cooldown supaya user yang baru join
    // bisa langsung mengulang perintahnya tanpa terkena cooldown.
    if (!(await requireJoin(ctx, parsed.command))) return;

    if (!checkCooldown(ctx.from.id, parsed.command, plugin.cooldown ?? 2000)) {
      return; // diamkan saat spam command
    }

    // Registrasi ringan data user
    // (username diperbarui tiap kali berubah supaya giveaway via @username selalu akurat)
    const uname = ctx.from.username || "";
    if (!user.name || (user.username || "") !== uname) {
      await saveUser(ctx.from.id, {
        name: user.name || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
        username: uname,
      });
    }

    // Fitur berbayar (config.js -> coin). Owner gratis.
    const cost = isOwner(ctx.from.id) ? 0 : getCost(plugin, parsed.command);
    if (cost > 0 && !spend(ctx.from.id, cost)) {
      return ctx.reply(
        `<tg-emoji emoji-id="6089104607328342288">💰</tg-emoji> Koin kamu tidak cukup.\nFitur ini butuh ${escH(cost)} koin, koin kamu: ${escH(getUser(ctx.from.id).koin || 0)}.\nKetik /claim untuk klaim ${escH(config.coin?.dailyClaim ?? 500)} koin gratis setiap hari.`,
        { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } }
      );
    }

    await bumpStats(parsed.command);
    const exec = () => withLoading(ctx, plugin, () => plugin.run(ctx, { args: parsed.args, text: parsed.text }));
    if (cost > 0) {
      await runPaid(ctx, cost, exec);
    } else {
      await exec();
    }
  } catch (err) {
    console.error("[HANDLER] Error:", err);
    try {
      await ctx.reply("<tg-emoji emoji-id=\"5420323339723881652\">⚠️</tg-emoji> Terjadi kesalahan saat menjalankan perintah.", { parse_mode: "HTML" });
    } catch {}
  }
}

/** Event member baru masuk grup -> welcome (satu pesan untuk semua member baru) */
export async function newMemberHandler(ctx) {
  const { getGroup } = await import("./database.js");
  const group = getGroup(ctx.chat.id);
  if (!group.welcome) return;
  const members = (ctx.message.new_chat_members || []).filter((m) => !m.is_bot);
  if (!members.length) return;
  const { sendGreeting } = await import("./lib/greeting.js");
  await sendGreeting(ctx, group, "welcome", members);
}

/** Event member keluar/dikeluarkan -> goodbye */
export async function leftMemberHandler(ctx) {
  const { getGroup } = await import("./database.js");
  const group = getGroup(ctx.chat.id);
  if (!group.goodbye) return;
  const member = ctx.message.left_chat_member;
  if (!member || member.is_bot) return;
  const { sendGreeting } = await import("./lib/greeting.js");
  await sendGreeting(ctx, group, "goodbye", [member]);
}

const ANTILINK_TTL = 6000; // peringatan dihapus otomatis
const ANTILINK_GAP = 10000; // maks 1 peringatan per user per 10 detik
const antiLinkLast = new Map();

/** Anti-link: hapus link undangan grup/channel (Telegram, WhatsApp, Discord), termasuk link tersembunyi & tombol URL */
export async function antiLinkHandler(ctx, next) {
  if (ctx.chat.type === "private") return next();
  const group = getGroup(ctx.chat.id);
  if (!group.antilink) return next();

  const msg = ctx.message;
  if (msg.is_automatic_forward || msg.sender_chat?.id === ctx.chat.id) return next(); // posting channel tertaut / admin anonim
  if (!ctx.from || ctx.from.is_bot) return next();

  const text = collectText(msg);
  if (!text || !PROMO_LINKS.some((re) => re.test(text))) return next();

  if (isOwner(ctx.from.id) || (await isAdminFast(ctx))) return next(); // admin boleh kirim link

  // ANTI DELAY: hapus pesan & mute (Mode Ketat) dimulai bersamaan, tidak saling menunggu
  const delP = ctx.deleteMessage().then(() => null, (err) => err);
  const muteP = isStrict(group) ? strictMute(ctx.telegram, ctx.chat.id, ctx.from.id) : null;
  const delErr = await delP;
  if (delErr) {
    console.error("[ANTILINK] Gagal hapus pesan:", delErr.message);
    return next();
  }

  const key = `${ctx.chat.id}:${ctx.from.id}`;
  const now = Date.now();
  if (now - (antiLinkLast.get(key) || 0) < ANTILINK_GAP) return;
  antiLinkLast.set(key, now);
  if (antiLinkLast.size > 500) antiLinkLast.delete(antiLinkLast.keys().next().value);

  // Peringatan di latar belakang supaya antrean update berikutnya tidak tertahan
  void (async () => {
    const muted = muteP ? await muteP : false;
    const tail = muted ? `\n<tg-emoji emoji-id="5213391561999526028">🔇</tg-emoji> Dimute <b>${fmtDuration(STRICT_MUTE_SEC)}</b> (Mode Ketat).` : "";
    const sent = await ctx.reply(`<tg-emoji emoji-id="5240241223632954241">🚫</tg-emoji> ${mention(ctx.from.id, fullName(ctx.from))}, dilarang kirim link grup/channel lain di sini.${tail}`, { parse_mode: "HTML" }).catch(() => null);
    if (sent) {
      const t = setTimeout(() => ctx.telegram.deleteMessage(sent.chat.id, sent.message_id).catch(() => {}), ANTILINK_TTL);
      t.unref?.();
    }
  })();
}

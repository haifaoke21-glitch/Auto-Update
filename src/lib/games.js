import fs from "fs";
import path from "path";
import { saveUser, getUser } from "../database.js";
import { rand, esc, displayName, escH } from "./util.js";
import { hasJoinedAll } from "./forceJoin.js";

export const GAME_DIR = path.join(process.cwd(), "data", "game");
const active = new Map(); // chatId -> state

export function listGameData() {
  if (!fs.existsSync(GAME_DIR)) return [];
  return fs.readdirSync(GAME_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

export function loadQuestions(name) {
  const file = path.join(GAME_DIR, `${name}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  return Array.isArray(data) ? data : [];
}

export const normalize = (s = "") =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function isCorrect(input, answer) {
  const a = normalize(input);
  const b = normalize(answer);
  if (!a || !b) return false;
  if (a === b) return true;
  return b.length >= 6 && lev(a, b) <= 1; // toleransi typo 1 huruf untuk jawaban panjang
}

export const getActive = (chatId) => active.get(String(chatId));

export function clearGame(chatId) {
  const st = active.get(String(chatId));
  if (st?.timer) clearTimeout(st.timer);
  active.delete(String(chatId));
}

export async function giveReward(userId) {
  const user = getUser(userId);
  const koin = rand(500, 1500);
  const exp = rand(100, 400);
  await saveUser(userId, { koin: (user.koin || 0) + koin, exp: (user.exp || 0) + exp });
  return { koin, exp };
}

export function startGame(ctx, state, timeoutMs = 60000) {
  const chatId = String(ctx.chat.id);
  clearGame(chatId);
  state.startedAt = Date.now();
  state.timer = setTimeout(async () => {
    if (active.get(chatId) !== state) return;
    active.delete(chatId);
    try {
      const reveal = Array.isArray(state.answer) ? state.answer.join(", ") : state.answer;
      await ctx.telegram.sendMessage(chatId, `<tg-emoji emoji-id="5985616167740379273">⏰</tg-emoji> Waktu habis!\nJawaban: <b>${escH(reveal)}</b>`, { parse_mode: "HTML" });
    } catch {}
  }, timeoutMs);
  active.set(chatId, state);
}

/** Dipanggil untuk setiap pesan teks non-command */
export async function gameAnswerHandler(ctx, next) {
  const st = getActive(ctx.chat.id);
  const text = ctx.message?.text;
  if (!st || !text || text.startsWith("/")) return next();
  // Jawaban game dari user yang belum join channel diabaikan (tidak dapat hadiah)
  if (!(await hasJoinedAll(ctx.telegram, ctx.from.id))) return next();

  if (st.kind === "family") {
    const idx = st.answer.findIndex((a, i) => !st.found[i] && isCorrect(text, a));
    if (idx === -1) return next();
    st.found[idx] = ctx.from.id;
    const r = await giveReward(ctx.from.id);
    const board = st.answer.map((a, i) => (st.found[i] ? `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> ${escH(a)}` : `${i + 1}. <tg-emoji emoji-id="6269561132898325478">❓</tg-emoji>`)).join("\n");
    await ctx.replyWithHTML(`<tg-emoji emoji-id="6327875261085783004">🎉</tg-emoji> ${escH(displayName(ctx.from))} benar! +${escH(r.koin)} koin\n\n${board}`);
    if (st.found.every(Boolean)) {
      clearGame(ctx.chat.id);
      await ctx.reply("<tg-emoji emoji-id=\"6120946172010959542\">🏁</tg-emoji> Semua jawaban terungkap!", { parse_mode: "HTML" });
    }
    return;
  }

  if (!isCorrect(text, st.answer)) return next();
  clearGame(ctx.chat.id);
  const r = await giveReward(ctx.from.id);
  await ctx.replyWithHTML(
    `<tg-emoji emoji-id="6327875261085783004">🎉</tg-emoji> <b>Benar!</b> ${escH(displayName(ctx.from))} menjawab <b>${escH(st.answer)}</b>\n+${escH(r.koin)} koin, +${escH(r.exp)} exp`
  );
}

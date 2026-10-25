import { registerCallback } from "../../src/lib/callbacks.js";
import { displayName } from "../../src/lib/util.js";
import { GameStore, mention, newId, reward, editMsg, answer } from "../../src/lib/games/common.js";

// ===== Pengaturan =====
const REWARD_PVP = 300; // koin untuk pemenang lawan manusia
const REWARD_BOT = 150; // koin untuk pemenang lawan bot
const BOT_ACCURACY = 0.75; // peluang bot memilih langkah terbaik (sisanya acak) -> masih bisa dikalahkan
const MIN_MOVES_REWARD = 4; // menyerah sebelum papan terisi sebanyak ini = tanpa hadiah (cegah farming)
const SYM = { X: "❌", O: "⭕" };
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

// ===== Logika papan =====
function check(b) {
  for (const l of LINES) {
    const [x, y, z] = l;
    if (b[x] && b[x] === b[y] && b[y] === b[z]) return { w: b[x], line: l };
  }
  return b.every(Boolean) ? { w: "draw", line: null } : null;
}

function minimax(b, turn, me, depth = 0) {
  const r = check(b);
  if (r) return r.w === "draw" ? 0 : r.w === me ? 10 - depth : depth - 10;
  let best = turn === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const s = minimax(b, turn === "X" ? "O" : "X", me, depth + 1);
    b[i] = null;
    best = turn === me ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function botPick(board, sym) {
  const empty = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (Math.random() > BOT_ACCURACY || empty.length === 9) return empty[Math.floor(Math.random() * empty.length)];
  let best = [], bestScore = -Infinity;
  for (const i of empty) {
    const b = board.slice();
    b[i] = sym;
    const s = minimax(b, sym === "X" ? "O" : "X", sym, 1);
    if (s > bestScore) { bestScore = s; best = [i]; } else if (s === bestScore) best.push(i);
  }
  return best[Math.floor(Math.random() * best.length)];
}

// ===== State =====
const store = new GameStore(15 * 60 * 1000, async (g) => {
  if (g.status === "done") return editMsg(g, view(g).text, undefined);
  await editMsg(g, `${head(g)}\n\n⏰ Game kedaluwarsa karena tidak ada aktivitas.`);
});

const botPlayer = () => ({ id: 0, name: "Bot", bot: true });
const pname = (p) => (p.bot ? "🤖 Bot" : mention(p.id, p.name));
const head = (g) => `🎮 <b>Tic Tac Toe</b>\n${SYM.X} ${pname(g.X)}  vs  ${SYM.O} ${g.O ? pname(g.O) : "<i>(menunggu lawan)</i>"}`;
const isPlayer = (g, uid) => uid === g.X.id || (g.O && !g.O.bot && uid === g.O.id);
const playerOf = (g, sym) => (sym === "X" ? g.X : g.O);

function boardKb(g) {
  const live = g.status === "play";
  const hot = new Set(g.line || []);
  const rows = [];
  for (let r = 0; r < 3; r++) {
    rows.push(
      [0, 1, 2].map((c) => {
        const i = r * 3 + c;
        const v = g.board[i];
        const text = hot.has(i) ? "🟩" : v ? SYM[v] : "▫️";
        return { text, callback_data: live && !v ? `ttt:${g.id}:m:${i}` : `ttt:${g.id}:z` };
      })
    );
  }
  return rows;
}

function view(g) {
  if (g.status === "lobby") {
    return {
      text: `${head(g)}\n\nMenunggu lawan. Tekan <b>Gabung</b> untuk melawan ${pname(g.X)}, atau mainkan melawan bot.`,
      markup: { inline_keyboard: [[{ text: "✋ Gabung", callback_data: `ttt:${g.id}:j` }, { text: "🤖 Lawan Bot", callback_data: `ttt:${g.id}:b` }], [{ text: "✖️ Batal", callback_data: `ttt:${g.id}:x` }]] },
    };
  }
  if (g.status === "challenge") {
    return {
      text: `${head(g)}\n\n${pname(g.X)} menantang ${pname(g.O)}! ${pname(g.O)}, terima tantangannya?`,
      markup: { inline_keyboard: [[{ text: "✅ Terima", callback_data: `ttt:${g.id}:a` }, { text: "❌ Tolak", callback_data: `ttt:${g.id}:r` }]] },
    };
  }
  if (g.status === "play") {
    const p = playerOf(g, g.turn);
    return {
      text: `${head(g)}\n\nGiliran: ${SYM[g.turn]} ${pname(p)}`,
      markup: { inline_keyboard: [...boardKb(g), [{ text: "🏳️ Menyerah", callback_data: `ttt:${g.id}:f` }]] },
    };
  }
  // done
  let res;
  if (g.winner === "draw") res = "🤝 <b>Seri!</b>";
  else {
    res = `🏆 Pemenang: ${SYM[g.winner]} ${pname(playerOf(g, g.winner))}${g.reason ? ` <i>(${g.reason})</i>` : ""}`;
    if (g.prize) res += `\n🪙 +${g.prize} koin`;
  }
  return {
    text: `${head(g)}\n\n${res}`,
    markup: { inline_keyboard: [...boardKb(g), [{ text: "🔁 Main Lagi", callback_data: `ttt:${g.id}:n` }]] },
  };
}

const show = (g) => { const v = view(g); return editMsg(g, v.text, v.markup); };

function begin(g) {
  g.status = "play";
  g.board = Array(9).fill(null);
  g.turn = "X";
  g.winner = null;
  g.line = null;
  g.reason = null;
  g.prize = 0;
  store.bump(g);
}

async function finish(g, winner, line = null, reason = null, giveReward = true) {
  g.status = "done";
  g.winner = winner;
  g.line = line;
  g.reason = reason;
  g.prize = 0;
  const w = winner === "draw" ? null : playerOf(g, winner);
  if (w && !w.bot && giveReward) {
    const loser = playerOf(g, winner === "X" ? "O" : "X");
    g.prize = loser.bot ? REWARD_BOT : REWARD_PVP;
  }
  store.bump(g, 5 * 60 * 1000); // tombol "Main Lagi" aktif 5 menit
  const prize = g.prize;
  await show(g);
  if (prize) await reward(w.id, prize, 30);
}

function scheduleBot(g) {
  const p = playerOf(g, g.turn);
  if (g.status !== "play" || !p?.bot || g.botBusy) return;
  g.botBusy = true;
  const t = setTimeout(async () => {
    g.botBusy = false;
    if (g.status !== "play" || !playerOf(g, g.turn)?.bot) return;
    await applyMove(g, botPick(g.board, g.turn));
  }, 700);
  t.unref?.();
}

/** Terapkan langkah (state diubah sinkron sebelum await apa pun supaya tidak balapan antar klik) */
async function applyMove(g, i) {
  g.board[i] = g.turn;
  const r = check(g.board);
  if (r) return finish(g, r.w, r.line);
  g.turn = g.turn === "X" ? "O" : "X";
  store.bump(g);
  await show(g);
  scheduleBot(g);
}

// ===== Callback tombol =====
registerCallback("ttt", async (ctx, [id, action, arg]) => {
  const g = store.get(id);
  if (!g) return answer(ctx, "Game sudah selesai atau kedaluwarsa.", true);
  const uid = ctx.from.id;

  switch (action) {
    case "z":
      return answer(ctx);

    case "j": { // gabung lobby
      if (g.status !== "lobby") return answer(ctx, "Game sudah dimulai.");
      if (uid === g.X.id) return answer(ctx, "Kamu pemain ❌. Tunggu lawan, atau pilih Lawan Bot.", true);
      g.O = { id: uid, name: displayName(ctx.from) };
      begin(g);
      await answer(ctx, "Kamu bermain sebagai ⭕");
      return show(g);
    }
    case "b": { // lawan bot
      if (g.status !== "lobby") return answer(ctx, "Game sudah dimulai.");
      if (uid !== g.X.id) return answer(ctx, "Hanya pembuat game yang bisa memilih bot.", true);
      g.O = botPlayer();
      begin(g);
      await answer(ctx);
      return show(g);
    }
    case "x": { // batal
      if (!["lobby", "challenge"].includes(g.status)) return answer(ctx);
      if (uid !== g.X.id) return answer(ctx, "Hanya pembuat game yang bisa membatalkan.", true);
      store.delete(id);
      await answer(ctx);
      return editMsg(g, `${head(g)}\n\n✖️ Game dibatalkan.`);
    }
    case "a": { // terima tantangan
      if (g.status !== "challenge") return answer(ctx);
      if (uid !== g.O.id) return answer(ctx, "Tantangan ini bukan untukmu.", true);
      begin(g);
      await answer(ctx);
      return show(g);
    }
    case "r": { // tolak tantangan
      if (g.status !== "challenge") return answer(ctx);
      if (uid !== g.O.id && uid !== g.X.id) return answer(ctx, "Tantangan ini bukan untukmu.", true);
      store.delete(id);
      await answer(ctx);
      return editMsg(g, `${head(g)}\n\n${uid === g.X.id ? "✖️ Tantangan ditarik." : `❌ ${pname(g.O)} menolak tantangan.`}`);
    }
    case "m": { // langkah
      if (g.status !== "play") return answer(ctx, "Game sudah selesai.");
      if (!isPlayer(g, uid)) return answer(ctx, "Kamu bukan pemain di game ini.", true);
      const cur = playerOf(g, g.turn);
      if (cur.bot || cur.id !== uid) return answer(ctx, "Bukan giliranmu!", true);
      const i = Number(arg);
      if (!(i >= 0 && i < 9) || g.board[i]) return answer(ctx, "Kotak sudah terisi.");
      await answer(ctx);
      return applyMove(g, i);
    }
    case "f": { // menyerah
      if (g.status !== "play") return answer(ctx);
      if (!isPlayer(g, uid)) return answer(ctx, "Kamu bukan pemain di game ini.", true);
      const other = uid === g.X.id ? "O" : "X";
      const filled = g.board.filter(Boolean).length;
      await answer(ctx);
      return finish(g, other, null, "lawan menyerah", filled >= MIN_MOVES_REWARD);
    }
    case "n": { // main lagi (tukar simbol)
      if (g.status !== "done") return answer(ctx);
      if (!isPlayer(g, uid)) return answer(ctx, "Hanya pemain game ini yang bisa main lagi.", true);
      [g.X, g.O] = [g.O, g.X];
      begin(g);
      await answer(ctx, "Ronde baru! Simbol ditukar.");
      await show(g);
      return scheduleBot(g);
    }
    default:
      return answer(ctx);
  }
});

export default {
  command: ["tictactoe"],
  hiddenCommands: ["ttt"],
  category: "game",
  description: "Tic Tac Toe lawan teman atau bot (reply teman untuk menantang, atau tambah kata bot untuk lawan bot)\nContoh: /tictactoe",
  cooldown: 3000,
  run: async (ctx, { args = [] } = {}) => {
    const me = { id: ctx.from.id, name: displayName(ctx.from) };
    const target = ctx.message?.reply_to_message?.from;
    if (target && target.id === me.id) return ctx.reply("❌ Tidak bisa menantang diri sendiri.");

    const id = newId();
    const g = { id, chatId: ctx.chat.id, telegram: ctx.telegram, X: me, O: null, board: Array(9).fill(null), turn: "X", status: "lobby" };
    if (target && !target.is_bot) {
      g.O = { id: target.id, name: displayName(target) };
      g.status = "challenge";
    } else if (target?.is_bot || args[0]?.toLowerCase() === "bot") {
      g.O = botPlayer();
      begin(g);
    }

    store.set(id, g);
    const v = view(g);
    try {
      const sent = await ctx.reply(v.text, { parse_mode: "HTML", reply_markup: v.markup });
      g.msgId = sent.message_id;
      if (g.status === "play") scheduleBot(g);
    } catch (err) {
      store.delete(id);
      throw err;
    }
  },
};

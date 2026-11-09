import { registerCallback } from "../../src/lib/callbacks.js";
import { pick, displayName } from "../../src/lib/util.js";
import { GameStore, mention, newId, reward, editMsg, answer } from "../../src/lib/games/common.js";

// ===== Pengaturan =====
const REWARD_BOT = 300; // koin tiap menang lawan bot (sama seperti sebelumnya)
const REWARD_PVP = 500; // koin untuk pemenang duel lawan manusia
const WIN_ROUNDS = 2; // best of 3
const MAX_ROUNDS = 9; // batas ronde (ronde seri tidak dihitung)

const OPT = { batu: "🪨 Batu", gunting: "✂️ Gunting", kertas: "📄 Kertas" };
const BEATS = { batu: "gunting", gunting: "kertas", kertas: "batu" };
/** 1 = a menang, -1 = b menang, 0 = seri */
const duel = (a, b) => (a === b ? 0 : BEATS[a] === b ? 1 : -1);

const chooser = (prefix) => [Object.entries(OPT).map(([k, v]) => ({ text: v, callback_data: `${prefix}${k}` }))];

// ===== Lawan bot (tanpa state) =====
function botChooserView(uid) {
  return {
    text: "✊ <b>Suit</b> lawan bot\n\nPilih senjatamu!\n<i>Tip: reply pesan teman dengan /suit untuk duel melawan manusia.</i>",
    markup: { inline_keyboard: chooser(`suit:b:`).map((row) => row.map((b) => ({ ...b, callback_data: `${b.callback_data}:${uid}` }))) },
  };
}

async function botRound(ctx, choice, ownerId) {
  if (String(ctx.from.id) !== String(ownerId)) return answer(ctx, "Ini bukan game kamu!", true);
  if (!OPT[choice]) return answer(ctx);
  const bot = pick(Object.keys(OPT));
  const r = duel(choice, bot);
  let hasil = "🤝 Seri!";
  if (r === 1) {
    hasil = `🎉 Kamu menang! +${REWARD_BOT} koin`;
    await reward(ctx.from.id, REWARD_BOT);
  } else if (r === -1) hasil = "😢 Kamu kalah!";
  await answer(ctx);
  try {
    await ctx.editMessageText(`✊ <b>Suit</b>\n\nKamu: ${OPT[choice]}\nBot: ${OPT[bot]}\n\n${hasil}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🔁 Main Lagi", callback_data: `suit:b:again:${ownerId}` }]] },
    });
  } catch {}
}

// ===== Duel lawan manusia =====
const store = new GameStore(10 * 60 * 1000, async (g) => {
  await editMsg(g, `${head(g)}\n\n⏰ Duel kedaluwarsa karena tidak ada aktivitas.`);
});

const head = (g) => `✊ <b>Suit</b> — Best of ${WIN_ROUNDS * 2 - 1}\n${mention(g.A.id, g.A.name)}  vs  ${mention(g.B.id, g.B.name)}`;
const sideOf = (g, uid) => (uid === g.A.id ? "A" : uid === g.B.id ? "B" : null);
const who = (g, s) => (s === "A" ? g.A : g.B);

function view(g) {
  if (g.status === "challenge") {
    return {
      text: `${head(g)}\n\n${mention(g.A.id, g.A.name)} menantang ${mention(g.B.id, g.B.name)}! Terima tantangannya?`,
      markup: { inline_keyboard: [[{ text: "✅ Terima", callback_data: `suit:${g.id}:a` }, { text: "❌ Tolak", callback_data: `suit:${g.id}:r` }]] },
    };
  }
  const score = `Skor: <b>${g.score.A}</b> – <b>${g.score.B}</b>`;
  const last = g.last ? `\n\n${g.last}` : "";
  if (g.status === "done") {
    const w = g.score.A === g.score.B ? null : g.score.A > g.score.B ? "A" : "B";
    const res = w ? `🏆 Pemenang: ${mention(who(g, w).id, who(g, w).name)}${g.prize ? `\n🪙 +${g.prize} koin` : ""}` : "🤝 <b>Seri!</b>";
    return { text: `${head(g)}\n\n${score}${last}\n\n${res}`, markup: { inline_keyboard: [] } };
  }
  const st = (s) => `${mention(who(g, s).id, who(g, s).name)}: ${g.picks[s] ? "✅ sudah memilih" : "⏳ belum memilih"}`;
  return {
    text: `${head(g)}\n\n${score}  •  Ronde ${g.round}\n${st("A")}\n${st("B")}${last}\n\n<i>Pilihanmu rahasia sampai kedua pemain memilih.</i>`,
    markup: { inline_keyboard: chooser(`suit:${g.id}:p:`).concat([[{ text: "🏳️ Menyerah", callback_data: `suit:${g.id}:f` }]]) },
  };
}

const show = (g) => { const v = view(g); return editMsg(g, v.text, v.markup); };

async function finishDuel(g, winner) {
  g.status = "done";
  store.delete(g.id);
  g.prize = 0;
  if (winner) g.prize = REWARD_PVP;
  await show(g);
  if (winner) await reward(who(g, winner).id, g.prize, 30);
}

registerCallback("suit", async (ctx, parts) => {
  // --- lawan bot: suit:b:<pilihan|again>:<ownerId> ; format lama: suit:<pilihan>:<ownerId>
  if (parts[0] === "b" || OPT[parts[0]]) {
    const [choice, ownerId] = parts[0] === "b" ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (choice === "again") {
      if (String(ctx.from.id) !== String(ownerId)) return answer(ctx, "Ini bukan game kamu!", true);
      await answer(ctx);
      const v = botChooserView(ownerId);
      return ctx.editMessageText(v.text, { parse_mode: "HTML", reply_markup: v.markup }).catch(() => {});
    }
    return botRound(ctx, choice, ownerId);
  }

  // --- duel PvP: suit:<id>:<aksi>[:<arg>]
  const [id, action, arg] = parts;
  const g = store.get(id);
  if (!g) return answer(ctx, "Duel sudah selesai atau kedaluwarsa.", true);
  const uid = ctx.from.id;

  switch (action) {
    case "a": {
      if (g.status !== "challenge") return answer(ctx);
      if (uid !== g.B.id) return answer(ctx, "Tantangan ini bukan untukmu.", true);
      g.status = "play";
      store.bump(g);
      await answer(ctx);
      return show(g);
    }
    case "r": {
      if (g.status !== "challenge") return answer(ctx);
      if (uid !== g.B.id && uid !== g.A.id) return answer(ctx, "Tantangan ini bukan untukmu.", true);
      store.delete(id);
      await answer(ctx);
      return editMsg(g, `${head(g)}\n\n${uid === g.A.id ? "✖️ Tantangan ditarik." : `❌ ${mention(g.B.id, g.B.name)} menolak tantangan.`}`);
    }
    case "p": {
      if (g.status !== "play") return answer(ctx, "Duel sudah selesai.");
      const s = sideOf(g, uid);
      if (!s) return answer(ctx, "Kamu bukan pemain di duel ini.", true);
      if (!OPT[arg]) return answer(ctx);
      if (g.picks[s]) return answer(ctx, `Kamu sudah memilih ${OPT[g.picks[s]]}. Tunggu lawan.`, true);
      g.picks[s] = arg; // sinkron: cegah klik ganda
      store.bump(g);
      if (!g.picks.A || !g.picks.B) {
        await answer(ctx, `Kamu memilih ${OPT[arg]}`);
        return show(g);
      }
      // kedua pemain sudah memilih -> hitung ronde
      const r = duel(g.picks.A, g.picks.B);
      const line = `Ronde ${g.round}: ${OPT[g.picks.A]} vs ${OPT[g.picks.B]} → ` +
        (r === 0 ? "seri (diulang)" : `${mention(who(g, r === 1 ? "A" : "B").id, who(g, r === 1 ? "A" : "B").name)} menang`);
      g.last = line;
      g.picks = { A: null, B: null };
      if (r === 1) g.score.A++; else if (r === -1) g.score.B++;
      g.round++;
      await answer(ctx);
      if (g.score.A >= WIN_ROUNDS) return finishDuel(g, "A");
      if (g.score.B >= WIN_ROUNDS) return finishDuel(g, "B");
      if (g.round > MAX_ROUNDS) return finishDuel(g, g.score.A === g.score.B ? null : g.score.A > g.score.B ? "A" : "B");
      return show(g);
    }
    case "f": {
      if (g.status !== "play") return answer(ctx);
      const s = sideOf(g, uid);
      if (!s) return answer(ctx, "Kamu bukan pemain di duel ini.", true);
      const w = s === "A" ? "B" : "A";
      g.score[w] = Math.max(g.score[w], WIN_ROUNDS);
      g.last = `${mention(who(g, s).id, who(g, s).name)} menyerah.`;
      await answer(ctx);
      if (g.round === 1) { // menyerah sebelum ada ronde dimainkan: tanpa hadiah (cegah farming)
        g.status = "done";
        store.delete(id);
        return show(g);
      }
      return finishDuel(g, w);
    }
    default:
      return answer(ctx);
  }
});

export default {
  command: ["suit"],
  category: "game",
  description: "Suit batu-gunting-kertas lawan bot atau duel teman best-of-3 (reply teman untuk menantang)\nContoh: /suit",
  cooldown: 3000,
  run: async (ctx) => {
    const target = ctx.message?.reply_to_message?.from;
    const me = { id: ctx.from.id, name: displayName(ctx.from) };

    if (target && target.id === me.id) return ctx.reply("❌ Tidak bisa menantang diri sendiri.");
    if (!target || target.is_bot) {
      const v = botChooserView(me.id);
      return ctx.reply(v.text, { parse_mode: "HTML", reply_markup: v.markup });
    }

    const id = newId();
    const g = {
      id, chatId: ctx.chat.id, telegram: ctx.telegram, status: "challenge",
      A: me, B: { id: target.id, name: displayName(target) },
      round: 1, score: { A: 0, B: 0 }, picks: { A: null, B: null }, last: null, prize: 0,
    };
    store.set(id, g);
    const v = view(g);
    try {
      const sent = await ctx.reply(v.text, { parse_mode: "HTML", reply_markup: v.markup });
      g.msgId = sent.message_id;
    } catch (err) {
      store.delete(id);
      throw err;
    }
  },
};

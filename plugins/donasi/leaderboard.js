import { showLeaderboard } from "../../src/lib/donate.js";

export default {
  command: ["leaderboard"],
  category: "donasi",
  description: "Peringkat donatur dengan total donasi tertinggi.",
  run: async (ctx, { args }) => showLeaderboard(ctx, args),
};

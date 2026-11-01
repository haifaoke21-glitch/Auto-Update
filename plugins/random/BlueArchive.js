import { BASE, registerSource, runRandom } from "../../src/lib/randomImg.js";

const KEY = "ba";
registerSource(KEY, { title: "Blue Archive", emoji: "🎮", urls: [`${BASE}/ba`] });

export default {
  command: ["ba", "bluearchive"],
  category: "random",
  description: "Gambar Blue Archive acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

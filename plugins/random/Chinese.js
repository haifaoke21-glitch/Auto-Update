import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_china";
registerSource(KEY, { title: "Cecan China", emoji: "🇨🇳", urls: cecanUrls("china") });

export default {
  command: ["cecanchina"],
  category: "random",
  description: "Foto cecan China acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

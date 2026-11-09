import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_korea";
registerSource(KEY, { title: "Cecan Korea", emoji: "🇰🇷", urls: cecanUrls("korea") });

export default {
  command: ["cecankorea"],
  category: "random",
  description: "Foto cecan Korea acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

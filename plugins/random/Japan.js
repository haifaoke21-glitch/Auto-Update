import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_japan";
registerSource(KEY, { title: "Cecan Japan", emoji: "🇯🇵", urls: cecanUrls("japan") });

export default {
  command: ["cecanjapan"],
  category: "random",
  description: "Foto cecan Japan acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_indonesia";
registerSource(KEY, { title: "Cecan Indonesia", emoji: "🇮🇩", urls: cecanUrls("indonesia") });

export default {
  command: ["cecanindonesia"],
  category: "random",
  description: "Foto cecan Indonesia acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

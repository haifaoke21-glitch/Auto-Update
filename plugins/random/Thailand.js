import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_thailand";
registerSource(KEY, { title: "Cecan Thailand", emoji: "🇹🇭", urls: cecanUrls("thailand") });

export default {
  command: ["cecanthailand"],
  category: "random",
  description: "Foto cecan Thailand acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

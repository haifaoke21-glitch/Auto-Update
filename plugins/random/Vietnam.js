import { registerSource, cecanUrls, runRandom } from "../../src/lib/randomImg.js";

const KEY = "cecan_vietnam";
registerSource(KEY, { title: "Cecan Vietnam", emoji: "🇻🇳", urls: cecanUrls("vietnam") });

export default {
  command: ["cecanvietnam"],
  category: "random",
  description: "Foto cecan Vietnam acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

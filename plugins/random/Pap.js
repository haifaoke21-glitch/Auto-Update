import { BASE, registerSource, runRandom } from "../../src/lib/randomImg.js";

const KEY = "pap";
registerSource(KEY, { title: "Pap", emoji: "📸", urls: [`${BASE}/pap`] });

export default {
  command: ["pap"],
  category: "random",
  description: "Gambar pap acak",
  cooldown: 5000,
  run: (ctx) => runRandom(ctx, KEY),
};

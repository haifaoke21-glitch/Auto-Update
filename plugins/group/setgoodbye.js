import { greetingCommand } from "../../src/lib/greeting.js";

export default greetingCommand({
  command: ["goodbye"],
  key: "goodbye",
  textKey: "goodbyeText",
  title: "Goodbye",
  description: "Atur pesan perpisahan saat member keluar.",
});

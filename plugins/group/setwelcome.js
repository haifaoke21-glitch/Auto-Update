import { greetingCommand } from "../../src/lib/greeting.js";

export default greetingCommand({
  command: ["welcome"],
  key: "welcome",
  textKey: "welcomeText",
  title: "Welcome",
  description: "Atur pesan selamat datang untuk member baru.",
});

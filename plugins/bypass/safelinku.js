import { makeBypassPlugin } from "../../src/lib/bypassApi.js";

export default makeBypassPlugin({
  command: ["safelinku"],
  endpoint: "safelinku",
  label: "Safelinku",
  example: "https://safelinku.com/xxxx",
});

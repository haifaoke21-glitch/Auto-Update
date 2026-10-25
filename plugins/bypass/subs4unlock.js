import { makeBypassPlugin, unlockRoutes } from "../../src/lib/bypassApi.js";

// Utama: https://api.theresav.eu/api/bypass/sub4unlock (cadangan: kyzzz /subs4unlock)
export default makeBypassPlugin({
  command: ["sub4unlock"],
  endpoint: "sub4unlock",
  label: "Sub4Unlock",
  example: "https://sub4unlock.io/xxxx",
  provider: "theresav",
  routes: unlockRoutes,
});

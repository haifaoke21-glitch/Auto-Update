import { makeBypassPlugin, unlockRoutes } from "../../src/lib/bypassApi.js";

// Utama: https://api.theresav.eu/api/bypass/sub2unlock (cadangan: sub4unlock theresav, subs4unlock kyzzz)
export default makeBypassPlugin({
  command: ["sub2unlock"],
  endpoint: "sub2unlock",
  label: "Sub2Unlock",
  example: "https://sub2unlock.com/xxxx",
  provider: "theresav",
  routes: unlockRoutes,
});

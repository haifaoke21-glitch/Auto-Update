import { makeBypassPlugin, generalRoutes } from "../../src/lib/bypassApi.js";

// Memakai 2 API (kyzzz + theresav): rute dipilih otomatis sesuai domain link, cadangan: kyzzz /bypass lalu theresav /universal.
export default makeBypassPlugin({
  command: ["bypass"],
  endpoint: "bypass",
  label: "umum (semua link)",
  example: "https://link-pendek.com/xxxx",
  routes: generalRoutes,
});

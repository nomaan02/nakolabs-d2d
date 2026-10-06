/**
 * UI-10 F1c (owner A51: admin and field share one Light / Dark / System
 * choice per device, key "d2d.theme"). The same pre-paint script as
 * `lib/field/theme.ts`, kept in a plain module: that file is "use client",
 * and a server layout must not read values out of a client module.
 * `npm run verify:ui10` checks the two strings stay identical.
 */
export const ADMIN_THEME_BOOT_SCRIPT =
  `(function(){try{var stored=localStorage.getItem("d2d.theme");var systemDark=false;try{systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}var theme=stored==="light"?"light":stored==="dark"?"dark":(systemDark?"dark":"light");document.documentElement.dataset.fieldTheme=theme;}catch(e){try{document.documentElement.dataset.fieldTheme="light";}catch(e2){}}})();`;

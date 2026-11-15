import { scriptURL } from "/omnishell/interpreter/script-url.js";
import { createShell } from "/omnishell/interpreter/shell.js";

const mount = document.getElementById("app");
if (!mount) throw new Error("boot: #app mount missing");

createShell({ config: "./shell.json", mount });

// The worker is an enhancement: a page it never controls still works, online. A registration the
// browser refuses (a certificate it does not trust, a private window, a policy) is logged, never
// left unhandled: before the shell has booted an unhandled rejection is its boot-failure banner,
// which would replace the screen with the browser's words about a script the reader never asked for.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(scriptURL("/offline-first-sw.js")).catch((err) => {
    console.warn("boot: the offline worker was not registered", err);
  });
}

import { renderAppSwitcher } from "../lib/app-switcher.js";

const appId = document.body.dataset.appId || "";
renderAppSwitcher(appId);

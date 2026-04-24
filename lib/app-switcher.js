import { APP_CATALOG } from "./app-catalog.js";

export function renderAppSwitcher(currentAppId, mountId = "appSwitcherHost") {
  const host = document.getElementById(mountId);
  if (!host) return;

  const wrap = document.createElement("div");
  wrap.className = "app-switcher";
  wrap.setAttribute("aria-label", "App switcher");

  const label = document.createElement("label");
  label.setAttribute("for", "appSelect");
  label.textContent = "App";

  const select = document.createElement("select");
  select.id = "appSelect";
  APP_CATALOG.forEach((app) => {
    const option = document.createElement("option");
    option.value = app.id;
    option.textContent = app.label;
    if (app.id === currentAppId) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    const picked = APP_CATALOG.find((a) => a.id === select.value);
    if (!picked) return;
    window.location.href = picked.href;
  });

  wrap.appendChild(label);
  wrap.appendChild(select);
  host.innerHTML = "";
  host.appendChild(wrap);
}

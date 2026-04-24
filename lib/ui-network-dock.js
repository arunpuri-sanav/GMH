/**
 * DOM helpers for the dev network log + response preview (optional for other apps).
 */

import { flattenForList } from "./utils.js";

export function getStatusChipText(statusCode, isError) {
  if (isError) return "ERR";
  if (!Number.isFinite(statusCode)) return "---";
  return String(statusCode);
}

export function getStatusChipClass(statusCode, isError) {
  if (isError) return "status-err";
  if (!Number.isFinite(statusCode)) return "status-3xx";
  if (statusCode >= 200 && statusCode < 300) return "status-2xx";
  if (statusCode >= 300 && statusCode < 400) return "status-3xx";
  if (statusCode >= 400 && statusCode < 500) return "status-4xx";
  return "status-5xx";
}

/**
 * @param {HTMLElement} networkLogEl
 * @param {Array<{ id: number, title: string, detail?: object|null, statusCode: number|null, isError: boolean }>} entries
 * @param {{
 *   selectedId: number|null
 *   onSelect: (entry: object) => void
 *   responsePreviewEl: HTMLElement
 * }} ctx
 */
export function renderNetworkLogList(networkLogEl, entries, ctx) {
  const { selectedId, onSelect, responsePreviewEl } = ctx;
  networkLogEl.innerHTML = "";
  entries.forEach((entry) => {
    const btn = document.createElement("button");
    btn.className = "network-log-item";
    if (entry.id === selectedId) btn.classList.add("is-selected");
    const chip = document.createElement("span");
    chip.className = `status-chip ${getStatusChipClass(entry.statusCode, entry.isError)}`;
    chip.textContent = getStatusChipText(entry.statusCode, entry.isError);
    const text = document.createElement("span");
    text.className = "network-log-text";
    text.textContent = entry.title;
    btn.appendChild(chip);
    btn.appendChild(text);
    btn.addEventListener("click", () => onSelect(entry));
    networkLogEl.appendChild(btn);
  });
  networkLogEl.scrollTop = networkLogEl.scrollHeight;
}

export function renderResponsePreviewList(responsePreviewEl, title, payload) {
  responsePreviewEl.innerHTML = "";
  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.marginBottom = "6px";
  heading.style.fontWeight = "700";
  responsePreviewEl.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "response-list";
  flattenForList(payload)
    .slice(0, 50)
    .forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
  if (!list.childElementCount) {
    const li = document.createElement("li");
    li.textContent = "(empty response body)";
    list.appendChild(li);
  }
  responsePreviewEl.appendChild(list);
}

export function exportNetworkEntriesAsDownload(entries, appendLog) {
  const payload = {
    exportedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      statusCode: entry.statusCode,
      isError: entry.isError,
      detail: entry.detail || null,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `network-results-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  appendLog("Exported network results JSON.");
}

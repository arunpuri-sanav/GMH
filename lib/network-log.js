/**
 * Optional request logging + fetch wrapper for devtools-style network panels.
 */

export function createNetworkLogStore({ maxEntries = 100 } = {}) {
  let seq = 0;
  const entries = [];
  const listeners = new Set();

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    const snapshot = entries.slice();
    listeners.forEach((fn) => fn(snapshot));
  }

  /** @param {string} message @param {null | { title?: string, payload?: unknown, statusCode?: number|null, isError?: boolean }} [detail] */
  function append(message, detail = null) {
    seq += 1;
    const timestamp = new Date().toLocaleTimeString();
    entries.push({
      id: seq,
      title: `[${timestamp}] ${message}`,
      detail,
      statusCode: detail?.statusCode ?? null,
      isError: detail?.isError ?? false,
    });
    if (entries.length > maxEntries) entries.shift();
    notify();
  }

  function getEntries() {
    return entries.slice();
  }

  return { append, subscribe, getEntries };
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ append: Function, onResponsePreview?: (title: string, payload: unknown) => void }} log
 */
export async function loggedFetch(url, options = {}, log) {
  const method = options.method || "GET";
  const started = performance.now();
  log.append(`${method} ${url}`);

  try {
    const response = await fetch(url, options);
    const elapsed = Math.round(performance.now() - started);
    const bodyText = await response.clone().text();
    let parsedBody;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : { empty: true };
    } catch {
      parsedBody = { raw: bodyText.slice(0, 3000) };
    }
    const title = `${method} ${url} -> ${response.status}`;
    log.append(`${title} (${elapsed}ms)`, {
      title,
      payload: parsedBody,
      statusCode: response.status,
      isError: false,
    });
    log.onResponsePreview?.(title, parsedBody);
    return response;
  } catch (error) {
    const elapsed = Math.round(performance.now() - started);
    const payload = { error: error.message, elapsed_ms: elapsed };
    const title = `${method} ${url} -> ERROR`;
    log.append(`${title} (${elapsed}ms): ${error.message}`, {
      title,
      payload,
      statusCode: null,
      isError: true,
    });
    log.onResponsePreview?.(title, payload);
    throw error;
  }
}

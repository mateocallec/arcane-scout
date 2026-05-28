/**
 * panel.js — orchestrator
 *
 * Connects NetworkCapture (network side) with UIManager (UI side).
 * Owns: clear, export (JSON + HAR), and the replay executor.
 */
import { NetworkCapture } from './network.js';
import { UIManager }      from './ui.js';

/* ── HAR 1.2 builder ─────────────────────────────────────────── */

function _parseQueryString(url) {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch (_) {
    return [];
  }
}

function _parseCookies(headers, isResponse = false) {
  const name   = isResponse ? 'set-cookie' : 'cookie';
  const header = headers.find((h) => h.name.toLowerCase() === name);
  if (!header) return [];

  if (isResponse) {
    const [nameVal] = header.value.split(';');
    const [n, v]    = nameVal.split('=').map((s) => s.trim());
    return [{ name: n || '', value: v || '' }];
  }

  return header.value.split(';').map((pair) => {
    const [n, v] = pair.trim().split('=').map((s) => s.trim());
    return { name: n || '', value: v || '' };
  });
}

function _toHAR(records) {
  const entries = records.map((r) => ({
    startedDateTime: new Date(r.timestamp).toISOString(),
    time: r.time,
    request: {
      method:      r.method,
      url:         r.url,
      httpVersion: 'HTTP/1.1',
      headers:     r.requestHeaders,
      cookies:     _parseCookies(r.requestHeaders, false),
      queryString: _parseQueryString(r.url),
      ...(r.requestPayload ? {
        postData: { mimeType: r.requestMimeType || 'application/x-www-form-urlencoded', text: r.requestPayload },
      } : {}),
      headersSize: -1,
      bodySize:    r.requestPayload ? r.requestPayload.length : -1,
    },
    response: {
      status:      r.status,
      statusText:  r.statusText,
      httpVersion: 'HTTP/1.1',
      headers:     r.responseHeaders,
      cookies:     _parseCookies(r.responseHeaders, true),
      content: {
        size:     r.responseBodySize || (r.responseBody?.length ?? 0),
        mimeType: r.responseMimeType || 'text/plain',
        text:     r.responseBody || '',
      },
      redirectURL: '',
      headersSize: -1,
      bodySize:    r.responseBodySize || -1,
    },
    cache:   {},
    timings: { send: 0, wait: r.time, receive: 0 },
  }));

  return {
    log: {
      version: '1.2',
      creator: { name: 'Arcane Scout', version: '1.0.0' },
      browser: { name: 'Chrome', version: '' },
      pages:   [],
      entries,
    },
  };
}

/* ── Replay executor (runs fetch inside the inspected page) ───── */

const REPLAY_FORBIDDEN = new Set([
  'content-length','transfer-encoding','host','connection',
  ':authority',':method',':path',':scheme','keep-alive','upgrade',
]);

function _makeReplayExecutor() {
  return ({ method, url, headers, body }) => new Promise((resolve, reject) => {
    const cleanHeaders = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (!REPLAY_FORBIDDEN.has(k.toLowerCase())) cleanHeaders[k] = v;
    }

    const fetchOpts = { method, headers: cleanHeaders };
    if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      fetchOpts.body = body;
    }

    // Expression runs inside the inspected page's JS context.
    // All user-supplied values are JSON-serialised to avoid injection.
    const expr = `(async function _apiInspectorReplay() {
  try {
    const t0  = Date.now();
    const res = await fetch(${JSON.stringify(url)}, ${JSON.stringify(fetchOpts)});
    const txt = await res.text();
    return JSON.stringify({
      status:     res.status,
      statusText: res.statusText,
      body:       txt,
      time:       Date.now() - t0,
    });
  } catch (e) {
    return JSON.stringify({ status: 0, statusText: 'Network Error', body: e.message, time: 0 });
  }
})()`;

    chrome.devtools.inspectedWindow.eval(expr, (result, exceptionInfo) => {
      if (exceptionInfo?.isException || exceptionInfo?.isError) {
        reject(new Error(exceptionInfo.description || exceptionInfo.value || 'Eval error'));
        return;
      }
      try {
        resolve(JSON.parse(result));
      } catch (_) {
        resolve({ status: 0, statusText: 'Parse Error', body: String(result), time: 0 });
      }
    });
  });
}

/* ── Boot ─────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  UIManager.init();

  // ── Clear ────────────────────────────────────────────────────
  UIManager.onClear(() => {
    NetworkCapture.clear();
    UIManager.clearRequests();
  });

  // ── Export ───────────────────────────────────────────────────
  UIManager.onExport((type) => {
    const records = NetworkCapture.getAll();
    if (!records.length) {
      UIManager.showToast('Nothing to export yet.');
      return;
    }

    let content, filename;

    if (type === 'har') {
      content  = JSON.stringify(_toHAR(records), null, 2);
      filename = `api-inspector-${Date.now()}.har`;
    } else {
      content  = JSON.stringify(records, null, 2);
      filename = `api-inspector-${Date.now()}.json`;
    }

    const blob = new Blob([content], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);

    UIManager.showToast(
      `Exported ${records.length} request${records.length !== 1 ? 's' : ''} as ${type.toUpperCase()}.`
    );
  });

  // ── Replay ───────────────────────────────────────────────────
  UIManager.setReplayExecutor(_makeReplayExecutor());

  // ── Capture ──────────────────────────────────────────────────
  NetworkCapture.init();
  NetworkCapture.onRequest((record) => UIManager.addRequest(record));
});

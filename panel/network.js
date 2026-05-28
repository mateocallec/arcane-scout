/**
 * NetworkCapture — listens to chrome.devtools.network.onRequestFinished,
 * filters to XHR/Fetch only, and emits parsed request records to subscribers.
 *
 * On init, existing entries already in the Network panel are loaded via
 * getHAR() so no page reload is required.
 *
 * Public API:
 *   NetworkCapture.init()              — start listening (call once)
 *   NetworkCapture.onRequest(fn)       — subscribe; returns unsubscribe fn
 *   NetworkCapture.clear()             — discard all stored records
 *   NetworkCapture.getAll()            — snapshot of all records
 */
export const NetworkCapture = (() => {
  const _records   = [];
  const _summaries = [];  // lightweight copies kept in sync with chrome.storage.session
  const _listeners = [];
  const _seen      = new Set();  // startedDateTime dedup between getHAR and onRequestFinished
  let _idCounter = 0;

  const API_TYPES = new Set(['xhr', 'fetch']);

  function _shouldCapture(entry) {
    return API_TYPES.has((entry._resourceType || '').toLowerCase());
  }

  function _parseEntry(entry, body, encoding) {
    const req = entry.request;
    const res = entry.response;

    let urlPath = req.url;
    let host = '';
    try {
      const u = new URL(req.url);
      host = u.host;
      urlPath = u.pathname + (u.search || '');
    } catch (_) { /* keep raw url */ }

    let responseBody = '';
    let isBinary = false;
    if (encoding === 'base64') {
      isBinary = true;
      responseBody = '[Binary content — not displayed]';
    } else {
      responseBody = body || '';
    }

    let requestPayload = null;
    let requestMimeType = null;
    if (req.postData) {
      requestPayload = req.postData.text || '';
      requestMimeType = req.postData.mimeType || null;
    }

    return {
      id: ++_idCounter,
      method: (req.method || 'GET').toUpperCase(),
      url: req.url,
      urlPath,
      host,
      status: res.status || 0,
      statusText: res.statusText || '',
      time: Math.round(entry.time),
      requestHeaders: req.headers || [],
      responseHeaders: res.headers || [],
      requestPayload,
      requestMimeType,
      responseBody,
      responseMimeType: res.content?.mimeType || '',
      responseBodySize: res.content?.size ?? 0,
      isBinary,
      timestamp: Date.now(),
    };
  }

  function _toSummary(r) {
    return {
      id: r.id, method: r.method, url: r.url,
      urlPath: r.urlPath, host: r.host,
      status: r.status, statusText: r.statusText,
      time: r.time, timestamp: r.timestamp,
    };
  }

  // Popup only needs a lightweight snapshot; cap to last 500 to stay within
  // session storage quota while keeping all records live in memory for the panel.
  function _saveAllToStorage() {
    const slice = _summaries.length > 500 ? _summaries.slice(-500) : _summaries;
    chrome.storage.session.set({ apiInspectorRecords: slice }).catch(() => {});
  }

  function _addRecord(record) {
    _records.push(record);
    _summaries.push(_toSummary(record));
    _listeners.forEach((fn) => fn(record));
  }

  function init() {
    // Load requests already captured in the Network panel (no reload needed)
    chrome.devtools.network.getHAR((har) => {
      for (const entry of (har.entries || [])) {
        if (!_shouldCapture(entry)) continue;
        _seen.add(entry.startedDateTime);
        const body     = entry.response?.content?.text     || '';
        const encoding = entry.response?.content?.encoding || '';
        _addRecord(_parseEntry(entry, body, encoding));
      }
      _saveAllToStorage();
    });

    // Capture future requests, deduplicating against anything getHAR() already returned
    chrome.devtools.network.onRequestFinished.addListener((entry) => {
      if (!_shouldCapture(entry)) return;
      if (_seen.has(entry.startedDateTime)) return;
      _seen.add(entry.startedDateTime);

      entry.getContent((body, encoding) => {
        _addRecord(_parseEntry(entry, body, encoding));
        _saveAllToStorage();
      });
    });
  }

  function onRequest(fn) {
    _listeners.push(fn);
    return () => {
      const i = _listeners.indexOf(fn);
      if (i !== -1) _listeners.splice(i, 1);
    };
  }

  function clear() {
    _records.length   = 0;
    _summaries.length = 0;
    _idCounter = 0;
    _seen.clear();
    chrome.storage.session.set({ apiInspectorRecords: [] }).catch(() => {});
  }

  function getAll() {
    return [..._records];
  }

  return { init, onRequest, clear, getAll };
})();

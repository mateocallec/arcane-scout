/**
 * UIManager — owns every DOM interaction in the panel.
 *
 * Public API:
 *   UIManager.init()                  — wire up static DOM
 *   UIManager.addRequest(record)      — append a row + update explorer tabs
 *   UIManager.clearRequests()         — wipe all rows + reset explorer tabs
 *   UIManager.applyFilter(text)       — show/hide rows by URL/method match
 *   UIManager.onClear(fn)             — register "clear" button handler
 *   UIManager.onExport(fn)            — fn(type) where type = 'json' | 'har'
 *   UIManager.setReplayExecutor(fn)   — provide async fn({method,url,headers,body}) → result
 *   UIManager.showToast(msg)          — brief notification
 */
export const UIManager = (() => {

  /* ── DOM refs (populated in init) ─────────────────────────── */
  let tbody, emptyRow, counter, filterInput, clearFilterBtn;
  let detailPanel, detailMethodBadge, detailUrl;
  let resizeHandle;
  let tabBtns, tabPanes;
  let toast;

  /* ── State ─────────────────────────────────────────────────── */
  let _selectedRow    = null;
  let _selectedRecord = null;
  let _filterText     = '';
  let _totalCount     = 0;
  let _replayExecutor = null;
  let _activeEtab     = 'requests';
  let _ctxMenu        = null;
  let _ctxRecord      = null;

  // Route tree
  let _treeRoot         = null;  // tree root node (built incrementally)
  let _routePattern     = null;  // RegExp | null — active route filter
  let _routeFilterLabel = '';    // display string for the active route filter

  // All records (needed for Header Auditor rebuild)
  const _allRecords = [];

  const _clearCallbacks  = [];
  const _exportCallbacks = [];

  /* ────────────────────────────────────────────────────────────
     Generic helpers
  ──────────────────────────────────────────────────────────── */

  function _escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _methodClass(m) {
    const up = m.toUpperCase();
    return ['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD'].includes(up) ? `m-${up}` : 'm-OTHER';
  }

  function _statusClass(s) {
    if (s >= 500) return 's-5xx';
    if (s >= 400) return 's-4xx';
    if (s >= 300) return 's-3xx';
    if (s >= 200) return 's-2xx';
    return 's-0xx';
  }

  function _timeClass(ms) {
    if (ms >= 2000) return 'time-slow';
    if (ms <= 200)  return 'time-fast';
    return '';
  }

  function _formatTime(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms + ' ms';
  }

  function _formatBytes(b) {
    if (b < 1024)         return b + ' B';
    if (b < 1024 * 1024)  return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function _looksLikeJSON(s) {
    const t = (s || '').trimStart();
    return t.startsWith('{') || t.startsWith('[');
  }

  /* ────────────────────────────────────────────────────────────
     Toast
  ──────────────────────────────────────────────────────────── */

  function _showToast(msg, duration = 2000) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  /* ────────────────────────────────────────────────────────────
     JSON syntax highlighter
  ──────────────────────────────────────────────────────────── */

  function _highlightJSON(raw) {
    let formatted;
    try {
      formatted = JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_) {
      return _escHtml(raw || '');
    }

    const RE = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
    let out = '', lastIdx = 0, m;

    while ((m = RE.exec(formatted)) !== null) {
      out += _escHtml(formatted.slice(lastIdx, m.index));
      const tok = m[0];
      let cls;
      if (tok.startsWith('"')) {
        cls = tok.endsWith(':') ? 'json-key' : 'json-str';
      } else if (tok === 'true' || tok === 'false') {
        cls = 'json-bool';
      } else if (tok === 'null') {
        cls = 'json-null';
      } else {
        cls = 'json-num';
      }
      out += `<span class="${cls}">${_escHtml(tok)}</span>`;
      lastIdx = RE.lastIndex;
    }
    return out + _escHtml(formatted.slice(lastIdx));
  }

  /* ────────────────────────────────────────────────────────────
     cURL generator
  ──────────────────────────────────────────────────────────── */

  const CURL_SKIP = new Set(['host','content-length',':authority',':method',':path',':scheme']);

  function _toCurl(r) {
    const esc = (s) => String(s).replace(/'/g, "'\\''");
    const lines = [`curl -X ${r.method} '${esc(r.url)}'`];
    lines.push(`  -L --compressed`);
    for (const h of r.requestHeaders) {
      if (CURL_SKIP.has(h.name.toLowerCase())) continue;
      lines.push(`  -H '${esc(h.name)}: ${esc(h.value)}'`);
    }
    if (r.requestPayload) lines.push(`  --data '${esc(r.requestPayload)}'`);
    return lines.join(' \\\n');
  }

  /* ────────────────────────────────────────────────────────────
     JWT helpers
  ──────────────────────────────────────────────────────────── */

  const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;

  function _containsJWT(value) {
    return JWT_RE.test(value || '');
  }

  function _decodeJWT(rawValue) {
    const token = (rawValue.match(JWT_RE) || [])[0];
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const b64 = (s) => {
        const p = s.replace(/-/g, '+').replace(/_/g, '/');
        const pad = p.length % 4;
        return atob(pad ? p + '='.repeat(4 - pad) : p);
      };
      return {
        header:  JSON.parse(b64(parts[0])),
        payload: JSON.parse(b64(parts[1])),
        rawSig:  parts[2],
      };
    } catch (_) {
      return null;
    }
  }

  function _jwtDecodedHTML(decoded) {
    const { header, payload } = decoded;
    const now = Math.floor(Date.now() / 1000);

    let expBadge = '';
    if (payload.exp) {
      const d = new Date(payload.exp * 1000).toLocaleString();
      expBadge = payload.exp < now
        ? `<span class="jwt-badge jwt-expired">EXPIRED ${d}</span>`
        : `<span class="jwt-badge jwt-valid">Valid until ${d}</span>`;
    } else {
      expBadge = '<span class="jwt-badge jwt-unknown">No expiry</span>';
    }

    return `
      <div class="jwt-decoded">
        <div class="jwt-section">
          <div class="jwt-section-header">
            Header
            <span class="jwt-badge" style="color:var(--json-key);background:rgba(156,220,254,.1)">${_escHtml(header.alg || '?')} / ${_escHtml(header.typ || '?')}</span>
          </div>
          <div class="code-block"><pre>${_highlightJSON(JSON.stringify(header))}</pre></div>
        </div>
        <div class="jwt-section">
          <div class="jwt-section-header">Payload ${expBadge}</div>
          <div class="code-block"><pre>${_highlightJSON(JSON.stringify(payload))}</pre></div>
        </div>
        <div class="jwt-section">
          <div class="jwt-section-header">Signature</div>
          <p class="jwt-sig-note">⚠ Signature cannot be verified without the secret key — do not trust unsigned claims.</p>
        </div>
      </div>`;
  }

  /* ────────────────────────────────────────────────────────────
     Secret detection (body / response)
  ──────────────────────────────────────────────────────────── */

  const _SECRET_PATTERNS = [
    { label: 'JWT token',          re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
    { label: 'AWS Access Key',     re: /\bAKIA[0-9A-Z]{16}\b/ },
    { label: 'PEM private key',    re: /-----BEGIN [A-Z ]{1,20}PRIVATE KEY-----/ },
    { label: 'Basic auth token',   re: /\bBasic\s+[A-Za-z0-9+/=]{20,}/i },
    { label: 'Sensitive JSON field',
      re: /"(?:password|secret|api_?key|access_?token|auth_?token|client_?secret|private_?key|refresh_?token)"\s*:\s*"[^"]{3,}"/i },
  ];

  function _detectSecrets(text) {
    if (!text) return [];
    return _SECRET_PATTERNS
      .filter(({ re }) => re.test(text))
      .map(({ label }) => label);
  }

  function _secretBannerHTML(findings) {
    if (!findings.length) return '';
    const items = findings.map((f) => `<li>${_escHtml(f)}</li>`).join('');
    return `
      <div class="secret-banner">
        <span class="secret-banner-icon">⚠</span>
        <div>
          <strong>Potential secrets detected:</strong>
          <ul>${items}</ul>
        </div>
      </div>`;
  }

  /* ────────────────────────────────────────────────────────────
     Route tree — normalization & incremental build
  ──────────────────────────────────────────────────────────── */

  function _newTreeNode(label) {
    return { label, children: new Map(), records: [], totalCount: 0 };
  }

  // Detects path segments that are dynamic identifiers (IDs, UUIDs, hashes…)
  const _DYNAMIC_RES = [
    /^\d+$/,                                                                    // pure digits
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,       // UUID
    /^[0-9a-f]{12,}$/i,                                                         // hex >= 12 chars
  ];

  function _isDynamic(seg) {
    if (!seg) return false;
    if (_DYNAMIC_RES.some((re) => re.test(seg))) return true;
    // Long mixed alphanumeric (>= 20 chars with both letters and digits) — tokens, ULIDs, etc.
    return seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) && /[a-zA-Z]/.test(seg);
  }

  function _normalizeSegments(urlPath) {
    const path = (urlPath || '/').split('?')[0];
    const segs = path.split('/').filter(Boolean);
    let idx = 0;
    return segs.map((s) => (_isDynamic(s) ? `{:value${++idx}}` : s));
  }

  function _addRecordToTree(root, record) {
    const segs = _normalizeSegments(record.urlPath);
    let node = root;
    node.totalCount++;
    for (const seg of segs) {
      if (!node.children.has(seg)) node.children.set(seg, _newTreeNode(seg));
      node = node.children.get(seg);
      node.totalCount++;
    }
    node.records.push(record);
  }

  /* ────────────────────────────────────────────────────────────
     Route tree — rendering
  ──────────────────────────────────────────────────────────── */

  function _renderTreeNode(node, segments, depth) {
    const hasChildren = node.children.size > 0;
    const isParam     = node.label.startsWith('{:');

    const li   = document.createElement('li');
    li.className = 'tree-node';

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.segs = JSON.stringify(segments);
    item.style.paddingLeft = (depth * 16 + 8) + 'px';

    // Toggle arrow or spacer
    if (hasChildren) {
      const toggle = document.createElement('button');
      toggle.className   = 'tree-toggle';
      toggle.textContent = '▶';
      toggle.setAttribute('aria-label', 'Toggle');
      item.appendChild(toggle);
    } else {
      const sp = document.createElement('span');
      sp.className = 'tree-toggle-spacer';
      item.appendChild(sp);
    }

    // Segment label
    const label = document.createElement('span');
    label.className   = 'tree-seg' + (isParam ? ' tree-seg-param' : '');
    label.textContent = node.label || '/';
    item.appendChild(label);

    // Request count badge
    const badge = document.createElement('span');
    badge.className   = 'tree-count';
    badge.textContent = node.totalCount;
    item.appendChild(badge);

    li.appendChild(item);

    // Children list
    if (hasChildren) {
      const ul = document.createElement('ul');
      ul.className = 'tree-children collapsed';

      // Sort: static segments first, params last; alphabetical within each group
      const sorted = [...node.children.entries()].sort(([a], [b]) => {
        const ap = a.startsWith('{:'), bp = b.startsWith('{:');
        if (ap !== bp) return ap ? 1 : -1;
        return a.localeCompare(b);
      });

      for (const [seg, child] of sorted) {
        ul.appendChild(_renderTreeNode(child, [...segments, seg], depth + 1));
      }
      li.appendChild(ul);

      // Toggle click: expand / collapse
      item.querySelector('.tree-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = ul.classList.toggle('collapsed');
        item.querySelector('.tree-toggle').textContent = collapsed ? '▶' : '▼';
      });
    }

    // Label click: apply route filter → switch to Requests tab
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      _applyRouteFilter(segments);
    });

    label.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rec = _findLatestForSegments(segments);
      if (rec) _showCtxMenu(e.clientX, e.clientY, rec);
    });

    return li;
  }

  function _saveExpandedPaths(container) {
    const paths = new Set();
    container.querySelectorAll('.tree-children:not(.collapsed)').forEach((ul) => {
      const item = ul.previousElementSibling;
      if (item?.dataset.segs) paths.add(item.dataset.segs);
    });
    return paths;
  }

  function _restoreExpandedPaths(container, paths) {
    container.querySelectorAll('.tree-item[data-segs]').forEach((item) => {
      if (!paths.has(item.dataset.segs)) return;
      const ul = item.nextElementSibling;
      if (ul?.classList.contains('tree-children')) {
        ul.classList.remove('collapsed');
        const t = item.querySelector('.tree-toggle');
        if (t) t.textContent = '▼';
      }
    });
  }

  function _refreshRouteTree() {
    const container = document.getElementById('route-tree-container');
    const prevExpanded = _saveExpandedPaths(container);
    container.innerHTML = '';

    if (!_treeRoot || _treeRoot.totalCount === 0) {
      container.innerHTML = '<div class="etab-empty">No requests captured yet. Interact with the page to see traffic.</div>';
      return;
    }

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'tree-toolbar';

    const info = document.createElement('span');
    info.className   = 'tree-info';
    info.textContent = `${_treeRoot.totalCount} request${_treeRoot.totalCount !== 1 ? 's' : ''}`;
    toolbar.appendChild(info);

    if (_routePattern && _routeFilterLabel) {
      const clearBtn = document.createElement('button');
      clearBtn.className   = 'tree-filter-badge';
      clearBtn.textContent = `✕ ${_routeFilterLabel}`;
      clearBtn.title       = 'Clear route filter';
      clearBtn.addEventListener('click', _clearRouteFilter);
      toolbar.appendChild(clearBtn);
    }
    container.appendChild(toolbar);

    // Tree
    const root = document.createElement('ul');
    root.className = 'tree-root';

    const sorted = [..._treeRoot.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [seg, child] of sorted) {
      root.appendChild(_renderTreeNode(child, [seg], 0));
    }
    container.appendChild(root);

    // Restore or auto-expand first level on fresh render
    if (prevExpanded.size > 0) {
      _restoreExpandedPaths(container, prevExpanded);
    } else {
      Array.from(root.children).forEach((li) => {
        const ul = li.querySelector('.tree-children');
        if (ul) {
          ul.classList.remove('collapsed');
          const t = li.querySelector('.tree-toggle');
          if (t) t.textContent = '▼';
        }
      });
    }

    // Re-highlight active item
    if (_routeFilterLabel) {
      const target = JSON.stringify(_routeFilterLabel.split('/').filter(Boolean));
      container.querySelectorAll('.tree-item').forEach((el) => {
        el.classList.toggle('tree-active', el.dataset.segs === target);
      });
    }
  }

  /* ────────────────────────────────────────────────────────────
     Route filter
  ──────────────────────────────────────────────────────────── */

  function _applyRouteFilter(segments) {
    const escaped = segments.map((s) =>
      s.startsWith('{:') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    _routePattern     = new RegExp('^\\/?' + escaped.join('\\/') + '(?:\\/.*)?$');
    _routeFilterLabel = '/' + segments.join('/');

    const bar = document.getElementById('route-filter-bar');
    document.getElementById('route-filter-text').textContent = _routeFilterLabel;
    bar.classList.remove('hidden');

    _switchEtab('requests');
    _reapplyAllFilters();
  }

  function _clearRouteFilter() {
    _routePattern     = null;
    _routeFilterLabel = '';
    document.getElementById('route-filter-bar').classList.add('hidden');
    _reapplyAllFilters();
    if (_activeEtab === 'routes') _refreshRouteTree();
  }

  /* ────────────────────────────────────────────────────────────
     Header Auditor — security rules
  ──────────────────────────────────────────────────────────── */

  const _SECURITY_RULES = [
    {
      name: 'content-security-policy',
      label: 'Content-Security-Policy',
      missingLevel: 'high',
      missingMsg: 'Not present — XSS risk, no restriction on resource loading',
      checks: [
        { level: 'high',
          msg: "'unsafe-inline' without nonce/hash — arbitrary inline scripts allowed",
          fn: (v) => /unsafe-inline/i.test(v) && !/nonce-|sha(?:256|384|512)-/i.test(v) },
        { level: 'high',
          msg: "'unsafe-eval' allows eval() and Function(string) execution",
          fn: (v) => /unsafe-eval/i.test(v) },
        { level: 'high',
          msg: 'Wildcard * in default-src or script-src',
          fn: (v) => /default-src\s+['"]*\*|script-src\s+['"]*\*/i.test(v) },
      ],
    },
    {
      name: 'strict-transport-security',
      label: 'Strict-Transport-Security',
      missingLevel: 'high',
      missingMsg: 'Not present — HTTP downgrade attacks possible',
      checks: [
        { level: 'medium',
          msg: 'max-age < 1 year (31536000) — HSTS preload requires ≥1 year',
          fn: (v) => { const m = v.match(/max-age\s*=\s*(\d+)/i); return !m || +m[1] < 31536000; } },
        { level: 'low',
          msg: 'Missing includeSubDomains — subdomains not covered by HSTS',
          fn: (v) => !/includesubdomains/i.test(v) },
      ],
    },
    {
      name: 'x-content-type-options',
      label: 'X-Content-Type-Options',
      missingLevel: 'medium',
      missingMsg: 'Not present — MIME sniffing enabled, can enable XSS via crafted responses',
      checks: [
        { level: 'medium',
          msg: "Value should be 'nosniff'",
          fn: (v) => v.trim().toLowerCase() !== 'nosniff' },
      ],
    },
    {
      name: 'x-frame-options',
      label: 'X-Frame-Options',
      missingLevel: 'medium',
      missingMsg: 'Not present — clickjacking risk (unless CSP frame-ancestors is set)',
      checks: [
        { level: 'low',
          msg: 'ALLOW-FROM is deprecated — use CSP frame-ancestors directive instead',
          fn: (v) => /^ALLOW-FROM/i.test(v.trim()) },
      ],
    },
    {
      name: 'referrer-policy',
      label: 'Referrer-Policy',
      missingLevel: 'low',
      missingMsg: 'Not present — browser default may send full URL in Referer header',
      checks: [
        { level: 'medium',
          msg: "Sends full URL cross-origin — consider 'strict-origin-when-cross-origin'",
          fn: (v) => ['unsafe-url','origin-when-cross-origin','no-referrer-when-downgrade'].includes(v.trim().toLowerCase()) },
      ],
    },
    {
      name: 'permissions-policy',
      label: 'Permissions-Policy',
      missingLevel: 'low',
      missingMsg: 'Not present — browser feature access (camera, mic, etc.) unrestricted',
      checks: [
        { level: 'low',
          msg: 'Wildcard * grants permissions to all origins',
          fn: (v) => /=\s*\*|\((?:[^)]*,\s*)?\*/.test(v) },
      ],
    },
    {
      name: 'access-control-allow-origin',
      label: 'Access-Control-Allow-Origin',
      missingLevel: 'info',
      missingMsg: 'CORS not configured — cross-origin reads blocked (expected for same-origin APIs)',
      checks: [
        { level: 'medium',
          msg: "Wildcard '*' — any origin can read responses; verify no session data or user-specific content is returned",
          fn: (v) => v.trim() === '*' },
        { level: 'high',
          msg: "'null' origin trusted — exploitable via sandboxed iframes from any arbitrary page",
          fn: (v) => v.trim().toLowerCase() === 'null' },
      ],
      multiCheck: (vals, hostHeaders) => {
        const issues = [];
        if (vals.size > 1) {
          issues.push({
            level: 'high',
            msg: `${vals.size} distinct origin values observed — server dynamically reflects the Origin header (all requesting origins are effectively trusted)`,
          });
        }
        const acac = hostHeaders.get('access-control-allow-credentials');
        const credsTrue = acac && [...acac].some((v) => v.trim().toLowerCase() === 'true');
        if (credsTrue) {
          if ([...vals].some((v) => v.trim() === '*')) {
            issues.push({
              level: 'high',
              msg: "ACAO: * with Allow-Credentials: true — browsers reject this but it signals broken CORS logic; non-browser clients (mobile apps, curl) are unprotected",
            });
          } else if (vals.size > 1) {
            issues.push({
              level: 'high',
              msg: 'Credentials: true combined with reflected origin — any attacker origin receives credentialed cross-origin access (cookies, auth headers)',
            });
          }
        }
        return issues;
      },
    },
    {
      name: 'access-control-allow-credentials',
      label: 'Access-Control-Allow-Credentials',
      missingLevel: 'info',
      missingMsg: 'Not present — credentials excluded from cross-origin requests (secure default)',
      checks: [
        { level: 'medium',
          msg: "'true' — cookies and Authorization headers sent cross-origin; ensure Allow-Origin is a strict allowlist, never a wildcard or reflected value",
          fn: (v) => v.trim().toLowerCase() === 'true' },
        { level: 'info',
          msg: "Value other than 'true' has no effect per spec",
          fn: (v) => v.trim().toLowerCase() !== 'true' },
      ],
    },
    {
      name: 'access-control-allow-methods',
      label: 'Access-Control-Allow-Methods',
      missingLevel: 'info',
      missingMsg: 'Not present — only CORS-safe methods (GET, HEAD, POST with safe content types) allowed cross-origin',
      checks: [
        { level: 'medium',
          msg: "Wildcard '*' — all HTTP methods allowed cross-origin including DELETE, PUT, and PATCH",
          fn: (v) => v.trim() === '*' },
        { level: 'medium',
          msg: 'TRACE method exposed — enables Cross-Site Tracing (XST) to steal cookies and auth headers from cross-origin requests',
          fn: (v) => /\bTRACE\b/i.test(v) },
      ],
    },
    {
      name: 'access-control-allow-headers',
      label: 'Access-Control-Allow-Headers',
      missingLevel: 'info',
      missingMsg: 'Not present — only CORS-safe request headers accepted (Accept, Content-Type with safe MIME, etc.)',
      checks: [
        { level: 'low',
          msg: "Wildcard '*' — all request headers permitted cross-origin including custom authentication headers",
          fn: (v) => v.trim() === '*' },
        { level: 'medium',
          msg: 'Authorization header explicitly permitted — cross-origin requests can include auth tokens; verify Allow-Origin is strictly controlled',
          fn: (v) => /\bAuthorization\b/i.test(v) },
      ],
    },
    {
      name: 'cache-control',
      label: 'Cache-Control',
      missingLevel: 'info',
      missingMsg: 'Not present — API responses may be cached by browser or proxy (consider Pragma: no-cache for HTTP/1.0)',
      checks: [
        { level: 'info',
          msg: 'Missing no-store/no-cache/private — sensitive API responses may be cached',
          fn: (v) => !/no-store|no-cache|private/i.test(v) },
        { level: 'info',
          msg: "'public' allows CDN/shared-cache storage — verify no sensitive data is served",
          fn: (v) => /\bpublic\b/i.test(v) },
      ],
    },
  ];

  const _LEVEL_ORD = { high: 0, medium: 1, low: 2, info: 3, pass: 4 };

  /* ────────────────────────────────────────────────────────────
     Header Auditor — render
  ──────────────────────────────────────────────────────────── */

  function _buildHeadersByHost(records) {
    // Map<host, Map<headerNameLower, Set<headerValue>>>
    const byHost = new Map();
    for (const r of records) {
      const host = r.host || '(unknown)';
      if (!byHost.has(host)) byHost.set(host, new Map());
      const m = byHost.get(host);
      for (const h of (r.responseHeaders || [])) {
        const name = h.name.toLowerCase();
        if (!m.has(name)) m.set(name, new Set());
        m.get(name).add(h.value);
      }
    }
    return byHost;
  }

  function _refreshHeaderAudit() {
    const container = document.getElementById('header-audit-container');
    container.innerHTML = '';

    if (!_allRecords.length) {
      container.innerHTML = '<div class="etab-empty">No requests captured yet.</div>';
      return;
    }

    const byHost = _buildHeadersByHost(_allRecords);

    for (const [host, hostHeaders] of byHost) {
      const section = document.createElement('div');
      section.className = 'audit-host-section';

      // Host header
      const hostHdr = document.createElement('div');
      hostHdr.className   = 'audit-host-header';
      hostHdr.textContent = host;
      section.appendChild(hostHdr);

      // ── Security headers table ──────────────────────────────
      const secTitle = document.createElement('div');
      secTitle.className   = 'audit-section-title';
      secTitle.textContent = 'Security Headers';
      section.appendChild(secTitle);

      const secTable = document.createElement('table');
      secTable.className = 'audit-table';

      for (const rule of _SECURITY_RULES) {
        const vals = hostHeaders.get(rule.name);
        const tr   = document.createElement('tr');

        if (!vals) {
          // MISSING
          tr.innerHTML = `
            <td class="audit-name">${_escHtml(rule.label)}</td>
            <td class="audit-badge-cell"><span class="audit-badge audit-badge-${_escHtml(rule.missingLevel)}">MISSING</span></td>
            <td class="audit-detail audit-missing">${_escHtml(rule.missingMsg)}</td>
          `;
        } else {
          // Present — evaluate each value against checks
          const allIssues = [];
          for (const val of vals) {
            for (const chk of rule.checks) {
              if (chk.fn(val)) allIssues.push({ level: chk.level, msg: chk.msg, val });
            }
          }
          // Cross-header / multi-value checks (optional per rule)
          if (rule.multiCheck) {
            allIssues.push(...rule.multiCheck(vals, hostHeaders));
          }

          const worstLevel = allIssues.reduce(
            (best, issue) => _LEVEL_ORD[issue.level] < _LEVEL_ORD[best] ? issue.level : best,
            'pass'
          );

          const badgeLabel = worstLevel === 'pass' ? 'PASS' : 'WARN';
          const valArr     = [...vals];

          let detailHTML = `<code class="audit-value">${_escHtml(valArr[0])}</code>`;
          if (valArr.length > 1) {
            detailHTML += `<span class="audit-multi">+${valArr.length - 1} more</span>`;
          }
          for (const issue of allIssues) {
            detailHTML += `<div class="audit-issue audit-issue-${_escHtml(issue.level)}">⚠ ${_escHtml(issue.msg)}</div>`;
          }

          tr.innerHTML = `
            <td class="audit-name">${_escHtml(rule.label)}</td>
            <td class="audit-badge-cell"><span class="audit-badge audit-badge-${_escHtml(worstLevel === 'pass' ? 'pass' : worstLevel)}">${_escHtml(badgeLabel)}</span></td>
            <td class="audit-detail">${detailHTML}</td>
          `;
        }
        secTable.appendChild(tr);
      }
      section.appendChild(secTable);

      // ── All response headers table ──────────────────────────
      const allTitle = document.createElement('div');
      allTitle.className   = 'audit-section-title';
      allTitle.textContent = 'All Response Headers';
      section.appendChild(allTitle);

      const allTable = document.createElement('table');
      allTable.className = 'audit-table audit-all-headers';

      const sortedHdrs = [...hostHeaders.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [name, vals] of sortedHdrs) {
        const tr   = document.createElement('tr');
        const valArr = [...vals];
        const valsHTML = valArr.map((v) => `<code>${_escHtml(v)}</code>`).join('<br>');
        tr.innerHTML = `
          <td class="audit-hdr-name">${_escHtml(name)}</td>
          <td class="audit-hdr-val">${valsHTML}</td>
        `;
        allTable.appendChild(tr);
      }
      section.appendChild(allTable);

      container.appendChild(section);
    }
  }

  /* ────────────────────────────────────────────────────────────
     Explorer tab switching
  ──────────────────────────────────────────────────────────── */

  function _switchEtab(name) {
    _activeEtab = name;
    document.querySelectorAll('.etab').forEach((b) =>
      b.classList.toggle('active', b.dataset.etab === name)
    );
    document.querySelectorAll('.etab-pane').forEach((p) =>
      p.classList.toggle('hidden', p.id !== `etab-${name}`)
    );
    if (name === 'routes')  _refreshRouteTree();
    if (name === 'audit')   _refreshHeaderAudit();
    if (name === 'cookies') {
      detailPanel.classList.add('hidden');
      _refreshCookies();
    }
  }

  function _initExplorerTabs() {
    document.querySelectorAll('.etab').forEach((btn) => {
      btn.addEventListener('click', () => _switchEtab(btn.dataset.etab));
    });
  }

  /* ────────────────────────────────────────────────────────────
     Cookies tab
  ──────────────────────────────────────────────────────────── */

  const _ckTabId = chrome.devtools.inspectedWindow.tabId;
  const _CK_SK   = `ck_${_ckTabId}`;

  // Cross-browser: Firefox uses Promise-based browser.devtools API;
  // Chrome uses a callback. A 4 s timeout prevents infinite "Loading…".
  function _evalPageUrl() {
    return new Promise((resolve) => {
      let settled = false;
      const timer  = setTimeout(() => { if (!settled) { settled = true; resolve(''); } }, 4000);
      const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v || ''); } };
      try {
        if (typeof browser !== 'undefined' && browser.devtools?.inspectedWindow?.eval) {
          browser.devtools.inspectedWindow.eval('location.href')
            .then(([r, ex]) => finish(ex?.isException || ex?.isError ? '' : r))
            .catch(() => finish(''));
          return;
        }
        const ret = chrome.devtools.inspectedWindow.eval('location.href', (r, ex) => {
          if (ex && (ex.isException || ex.isError)) finish('');
          else finish(r);
        });
        if (ret && typeof ret.then === 'function') {
          ret.then(([r, ex]) => {
            if (ex && (ex.isException || ex.isError)) finish('');
            else finish(r);
          }).catch(() => finish(''));
        }
      } catch (_) { finish(''); }
    });
  }

  // Route all cookie API calls through the background script — Firefox
  // restricts chrome.cookies.* in devtools panel pages.
  function _bgCookieMsg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  function _getAllCookies(url) {
    return _bgCookieMsg({ type: 'getCookies', url })
      .then((r) => (r && r.cookies) || []);
  }

  function _ckGetDisabled() {
    return new Promise((resolve) => {
      try {
        chrome.storage.session.get({ [_CK_SK]: [] }, (r) => {
          if (chrome.runtime.lastError) { resolve([]); return; }
          resolve((r && r[_CK_SK]) || []);
        });
      } catch (_e) { resolve([]); }
    });
  }

  function _ckSetDisabled(list) {
    return chrome.storage.session.set({ [_CK_SK]: list }).catch(() => {});
  }

  function _ckCookieUrl(cookie) {
    const scheme = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    return `${scheme}://${domain}${cookie.path}`;
  }

  async function _refreshCookies() {
    const container = document.getElementById('cookie-container');
    if (!container) return;
    container.innerHTML = '<div class="etab-empty">Loading…</div>';

    const pageUrl = await _evalPageUrl();
    if (!pageUrl) {
      container.innerHTML = '<div class="etab-empty">Cannot determine page URL.</div>';
      return;
    }

    let liveCookies, disabledList;
    try {
      [liveCookies, disabledList] = await Promise.all([
        _getAllCookies(pageUrl),
        _ckGetDisabled(),
      ]);
    } catch (_e) {
      container.innerHTML = '<div class="etab-empty">Could not load cookies.</div>';
      return;
    }

    const allCookies = [
      ...liveCookies.map((c) => ({ ...c, _enabled: true })),
      ...disabledList
        .filter((dc) => !liveCookies.some(
          (lc) => lc.name === dc.name && lc.domain === dc.domain && lc.path === dc.path
        ))
        .map((c) => ({ ...c, _enabled: false })),
    ];

    if (!allCookies.length) {
      container.innerHTML = '<div class="etab-empty">No cookies for this page.</div>';
      return;
    }

    allCookies.sort((a, b) => {
      if (a._enabled !== b._enabled) return a._enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const table = document.createElement('table');
    table.className = 'ck-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th class="ck-th-check"></th>
      <th class="ck-th-name">Name</th>
      <th class="ck-th-value">Value</th>
      <th class="ck-th-domain">Domain / Path</th>
      <th class="ck-th-flags">Flags</th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const ck of allCookies) {
      const tr = document.createElement('tr');
      tr.className = ck._enabled ? 'ck-row' : 'ck-row ck-row-disabled';

      const flags = [];
      if (ck.httpOnly) flags.push({ text: 'HttpOnly', cls: 'ck-flag-sec' });
      if (ck.secure)   flags.push({ text: 'Secure',   cls: 'ck-flag-sec' });
      if (!ck.expirationDate) flags.push({ text: 'Session', cls: 'ck-flag-session' });
      if (ck.sameSite && ck.sameSite !== 'unspecified')
        flags.push({ text: `SameSite=${ck.sameSite}`, cls: 'ck-flag-same' });

      const shortVal  = ck.value.length > 48 ? ck.value.slice(0, 48) + '…' : ck.value;
      const domainPath = ck.domain + (ck.path !== '/' ? ck.path : '');
      const flagsHtml  = flags.map((f) => `<span class="ck-flag ${_escHtml(f.cls)}">${_escHtml(f.text)}</span>`).join('');

      tr.innerHTML = `
        <td class="ck-td-check"><input type="checkbox" class="ck-cb" ${ck._enabled ? 'checked' : ''}></td>
        <td class="ck-td-name"   title="${_escHtml(ck.name)}">${_escHtml(ck.name)}</td>
        <td class="ck-td-value"  title="${_escHtml(ck.value)}">${_escHtml(shortVal)}</td>
        <td class="ck-td-domain" title="${_escHtml(ck.domain + ck.path)}">${_escHtml(domainPath)}</td>
        <td class="ck-td-flags">${flagsHtml}</td>
      `;

      const cb = tr.querySelector('.ck-cb');
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          if (!cb.checked) {
            const disabled = await _ckGetDisabled();
            if (!disabled.some((d) => d.name === ck.name && d.domain === ck.domain && d.path === ck.path))
              disabled.push(ck);
            await _ckSetDisabled(disabled);
            await _bgCookieMsg({ type: 'removeCookie', url: _ckCookieUrl(ck), name: ck.name });
            tr.classList.add('ck-row-disabled');
          } else {
            const disabled = await _ckGetDisabled();
            const saved    = disabled.find((d) => d.name === ck.name && d.domain === ck.domain && d.path === ck.path);
            if (saved) {
              const params = {
                url:      _ckCookieUrl(saved),
                name:     saved.name,
                value:    saved.value,
                path:     saved.path,
                secure:   saved.secure,
                httpOnly: saved.httpOnly,
              };
              if (saved.domain)         params.domain = saved.domain;
              if (saved.expirationDate) params.expirationDate = saved.expirationDate;
              if (saved.sameSite && saved.sameSite !== 'unspecified') params.sameSite = saved.sameSite;
              await _bgCookieMsg({ type: 'setCookie', params });
              await _ckSetDisabled(disabled.filter((d) => !(d.name === ck.name && d.domain === ck.domain && d.path === ck.path)));
            }
            tr.classList.remove('ck-row-disabled');
          }
        } catch (_e) {
          cb.checked = !cb.checked;
        }
        cb.disabled = false;
      });

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
  }

  function _initCookies() {
    document.getElementById('btn-ck-refresh').addEventListener('click', _refreshCookies);
  }

  /* ────────────────────────────────────────────────────────────
     Context menu helpers
  ──────────────────────────────────────────────────────────── */

  function _showCtxMenu(x, y, record) {
    _ctxRecord = record;
    _ctxMenu.classList.remove('hidden');
    _ctxMenu.style.left = x + 'px';
    _ctxMenu.style.top  = y + 'px';
    // Adjust so the menu doesn't overflow the viewport
    const rect = _ctxMenu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  _ctxMenu.style.left = (x - rect.width)  + 'px';
    if (rect.bottom > window.innerHeight) _ctxMenu.style.top  = (y - rect.height) + 'px';
  }

  function _sendToPentest(record) {
    const SKIP = new Set([
      'host','content-length',':authority',':method',':path',':scheme',
      'connection','upgrade-insecure-requests',
    ]);
    const data = {
      method:  record.method,
      url:     record.url,
      headers: (record.requestHeaders || []).filter((h) => !SKIP.has(h.name.toLowerCase())),
      body:    record.requestPayload || '',
    };
    chrome.storage.local.set({ _pentestPrefill: data }, () => {
      _showToast('Sent to Custom Request — switch to the Pentest Tools panel');
    });
  }

  function _findLatestForSegments(segs) {
    for (let i = _allRecords.length - 1; i >= 0; i--) {
      const rSegs = _normalizeSegments(_allRecords[i].urlPath);
      if (rSegs.length >= segs.length && segs.every((s, j) => s === rSegs[j])) return _allRecords[i];
    }
    return null;
  }

  /* ────────────────────────────────────────────────────────────
     Row rendering
  ──────────────────────────────────────────────────────────── */

  function _renderRow(record) {
    const tr = document.createElement('tr');
    tr.className = 'req-row';
    tr.dataset.id = record.id;

    if ((_filterText && !_matchesFilter(record, _filterText)) ||
        (_routePattern && !_matchesRoutePattern(record))) {
      tr.classList.add('filtered');
    }

    tr.innerHTML = `
      <td><span class="method-badge ${_methodClass(record.method)}">${_escHtml(record.method)}</span></td>
      <td class="endpoint-cell" title="${_escHtml(record.url)}">
        <span class="endpoint-host">${_escHtml(record.host)}</span>${_escHtml(record.urlPath)}
      </td>
      <td><span class="status-badge ${_statusClass(record.status)}">${record.status || '—'}</span></td>
      <td class="time-cell ${_timeClass(record.time)}">${_formatTime(record.time)}</td>
    `;

    tr.addEventListener('click', () => _selectRow(tr, record));
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showCtxMenu(e.clientX, e.clientY, record);
    });
    return tr;
  }

  /* ────────────────────────────────────────────────────────────
     Detail panel
  ──────────────────────────────────────────────────────────── */

  function _selectRow(tr, record) {
    if (_selectedRow) _selectedRow.classList.remove('selected');
    _selectedRow   = tr;
    _selectedRecord = record;
    tr.classList.add('selected');
    _renderDetail(record);
    detailPanel.classList.remove('hidden');
  }

  function _activateTab(name) {
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    tabPanes.forEach((p) => {
      const active = p.id === `tab-${name}`;
      p.classList.toggle('hidden', !active);
      p.classList.toggle('active',  active);
    });
  }

  function _renderDetail(record) {
    detailMethodBadge.className   = `method-badge ${_methodClass(record.method)}`;
    detailMethodBadge.textContent = record.method;
    detailUrl.textContent         = record.url;
    detailUrl.title               = record.url;

    _activateTab('overview');
    _renderOverview(record);

    tabBtns.forEach((btn) => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        _activateTab(tab);
        if (tab === 'headers')  _renderHeaders(record);
        if (tab === 'payload')  _renderPayload(record);
        if (tab === 'response') _renderResponse(record);
        if (tab === 'replay')   _renderReplay(record);
      };
    });
  }

  /* ── Overview tab ─────────────────────────────────────────── */

  function _renderOverview(r) {
    const pane = document.getElementById('tab-overview');
    pane.innerHTML = `
      <div class="overview-grid">
        <div class="ov-label">Method</div>
        <div class="ov-value"><span class="method-badge tag ${_methodClass(r.method)}">${_escHtml(r.method)}</span></div>

        <div class="ov-label">Status</div>
        <div class="ov-value"><span class="status-badge tag ${_statusClass(r.status)}">${r.status} ${_escHtml(r.statusText)}</span></div>

        <div class="ov-label">Time</div>
        <div class="ov-value">${_formatTime(r.time)}</div>

        <div class="ov-label">URL</div>
        <div class="ov-value">${_escHtml(r.url)}</div>

        <div class="ov-label">Host</div>
        <div class="ov-value">${_escHtml(r.host || '—')}</div>

        <div class="ov-label">Path</div>
        <div class="ov-value">${_escHtml(r.urlPath || '/')}</div>

        ${r.responseMimeType ? `<div class="ov-label">MIME</div><div class="ov-value">${_escHtml(r.responseMimeType)}</div>` : ''}
        ${r.responseBodySize ? `<div class="ov-label">Size</div><div class="ov-value">${_formatBytes(r.responseBodySize)}</div>` : ''}
      </div>

      <div class="curl-section">
        <h4>Copy as cURL</h4>
        <div class="curl-box">
          <pre class="curl-code" id="curl-pre">${_escHtml(_toCurl(r))}</pre>
          <button class="curl-copy-btn" id="curl-copy-btn">Copy</button>
        </div>
      </div>
    `;

    document.getElementById('curl-copy-btn').addEventListener('click', function () {
      navigator.clipboard.writeText(_toCurl(r)).then(() => {
        this.textContent = 'Copied!';
        this.classList.add('copied');
        setTimeout(() => { this.textContent = 'Copy'; this.classList.remove('copied'); }, 1800);
      });
    });
  }

  /* ── Headers tab ──────────────────────────────────────────── */

  const _SENSITIVE_HDR = /authorization|x-api-key|token|secret|cookie|set-cookie|x-auth/i;

  function _renderHeaders(r) {
    const pane = document.getElementById('tab-headers');

    function buildRows(headers) {
      if (!headers?.length) return '<p class="empty-pane">No headers</p>';

      return `<table class="headers-table">${headers.map((h, idx) => {
        const isSensitive = _SENSITIVE_HDR.test(h.name);
        const hasJWT      = _containsJWT(h.value);
        const jwtBtn      = hasJWT
          ? `<button class="jwt-btn" data-row-idx="${idx}">🔓 Decode JWT</button>`
          : '';
        return `
          <tr class="header-row" data-idx="${idx}">
            <td class="header-name">${_escHtml(h.name)}</td>
            <td class="header-value ${isSensitive ? 'secret' : ''}">${_escHtml(h.value)}${jwtBtn}</td>
          </tr>
          ${hasJWT ? `<tr class="jwt-expanded-row hidden" data-for="${idx}"><td colspan="2"></td></tr>` : ''}
        `;
      }).join('')}</table>`;
    }

    pane.innerHTML = `
      <div class="headers-section">
        <h4>Request Headers</h4>${buildRows(r.requestHeaders)}
      </div>
      <div class="headers-section">
        <h4>Response Headers</h4>${buildRows(r.responseHeaders)}
      </div>
    `;

    pane.querySelectorAll('.jwt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx    = btn.dataset.rowIdx;
        const expRow = pane.querySelector(`.jwt-expanded-row[data-for="${idx}"]`);
        if (!expRow) return;

        const isHidden = expRow.classList.contains('hidden');
        if (isHidden) {
          const headerRow = pane.querySelector(`.header-row[data-idx="${idx}"]`);
          const rawVal    = headerRow?.querySelector('.header-value')?.textContent || '';
          const decoded   = _decodeJWT(rawVal);
          expRow.querySelector('td').innerHTML = decoded
            ? _jwtDecodedHTML(decoded)
            : '<p class="empty-pane">Could not decode token.</p>';
          expRow.classList.remove('hidden');
          btn.textContent = '🔒 Hide';
        } else {
          expRow.classList.add('hidden');
          btn.textContent = '🔓 Decode JWT';
        }
      });
    });
  }

  /* ── Payload tab ──────────────────────────────────────────── */

  function _renderPayload(r) {
    const pane = document.getElementById('tab-payload');

    if (!r.requestPayload) {
      pane.innerHTML = '<p class="empty-pane">No request body (GET or no payload)</p>';
      return;
    }

    const secrets = _detectSecrets(r.requestPayload);
    const isJSON  = _looksLikeJSON(r.requestPayload) || (r.requestMimeType || '').includes('json');

    pane.innerHTML = `
      ${_secretBannerHTML(secrets)}
      ${r.requestMimeType ? `<p class="mime-hint">${_escHtml(r.requestMimeType)}</p>` : ''}
      <div class="code-block"><pre>${isJSON ? _highlightJSON(r.requestPayload) : _escHtml(r.requestPayload)}</pre></div>
    `;
  }

  /* ── Response tab ─────────────────────────────────────────── */

  function _renderResponse(r) {
    const pane = document.getElementById('tab-response');
    const mime = (r.responseMimeType || '').split(';')[0].trim().toLowerCase();

    if (!r.responseBody || r.isBinary) {
      const label = r.isBinary ? `Binary response (${_escHtml(mime || 'unknown type')}) — not displayed.` : 'Empty response body.';
      pane.innerHTML = `<p class="empty-pane">${label}</p>`;
      return;
    }

    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      pane.innerHTML = `
        <div class="mv-wrapper">
          <div class="mv-bar">
            <span class="mv-type-tag">HTML</span>
            <button class="mv-toggle mv-active" data-show="preview">Preview</button>
            <button class="mv-toggle" data-show="source">Source</button>
          </div>
          <div class="mv-preview"><iframe class="mv-iframe" sandbox="allow-same-origin allow-forms"></iframe></div>
          <div class="mv-source hidden"><pre class="mv-src-pre"></pre></div>
        </div>
      `;
      pane.querySelector('.mv-iframe').srcdoc = r.responseBody;
      pane.querySelector('.mv-src-pre').textContent = r.responseBody;
      pane.querySelectorAll('.mv-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.show;
          pane.querySelectorAll('.mv-toggle').forEach((b) => b.classList.toggle('mv-active', b === btn));
          pane.querySelector('.mv-preview').classList.toggle('hidden', mode !== 'preview');
          pane.querySelector('.mv-source').classList.toggle('hidden', mode !== 'source');
        });
      });
      return;
    }

    const secrets = _detectSecrets(r.responseBody);
    const isJSON  = _looksLikeJSON(r.responseBody) || (r.responseMimeType || '').includes('json');

    pane.innerHTML = `
      ${_secretBannerHTML(secrets)}
      ${r.responseMimeType ? `<p class="mime-hint">${_escHtml(r.responseMimeType)}</p>` : ''}
      <div class="code-block"><pre>${isJSON ? _highlightJSON(r.responseBody) : _escHtml(r.responseBody)}</pre></div>
    `;
  }

  /* ── Replay tab ───────────────────────────────────────────── */

  const REPLAY_SKIP_HEADERS = new Set([
    'host','content-length','transfer-encoding',':authority',':method',':path',':scheme',
    'connection','keep-alive','upgrade','proxy-connection',
  ]);

  function _renderReplay(r) {
    const pane = document.getElementById('tab-replay');

    const cleanHeaders = r.requestHeaders.filter(
      (h) => !REPLAY_SKIP_HEADERS.has(h.name.toLowerCase())
    );
    const headersObj = Object.fromEntries(cleanHeaders.map((h) => [h.name, h.value]));

    const METHODS = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
    const methodOpts = METHODS.map((m) =>
      `<option value="${m}"${m === r.method ? ' selected' : ''}>${m}</option>`
    ).join('');

    pane.innerHTML = `
      <div class="replay-row-top">
        <select id="replay-method" class="replay-method-select">${methodOpts}</select>
        <input  id="replay-url"    class="replay-url-input" type="text"
                value="${_escHtml(r.url)}" spellcheck="false" />
      </div>

      <div class="replay-section-label">
        Headers <span class="replay-note">(hop-by-hop headers stripped)</span>
      </div>
      <textarea id="replay-headers" class="replay-textarea replay-headers-ta"
                spellcheck="false">${_escHtml(JSON.stringify(headersObj, null, 2))}</textarea>

      <div class="replay-section-label">Payload</div>
      <textarea id="replay-payload" class="replay-textarea replay-payload-ta"
                spellcheck="false" placeholder="Request body — leave empty for no body"
      >${r.requestPayload ? _escHtml(r.requestPayload) : ''}</textarea>

      <div class="replay-actions">
        <button id="replay-send" class="btn btn-send">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <line x1="2" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <polyline points="9,4 13,8 9,12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
          </svg>
          Send Request
        </button>
        <span class="replay-ctx-note">⚠ Runs in the page context — session cookies auto-attached</span>
      </div>

      <div class="replay-response-area hidden" id="replay-response-area">
        <div class="replay-response-meta">
          <span id="replay-res-badge" class="status-badge"></span>
          <span id="replay-res-time"  class="time-cell"></span>
        </div>
        <div class="code-block"><pre id="replay-res-body"></pre></div>
      </div>
    `;

    document.getElementById('replay-send').addEventListener('click', async () => {
      if (!_replayExecutor) { _showToast('Replay executor not available.'); return; }

      const method  = document.getElementById('replay-method').value;
      const url     = document.getElementById('replay-url').value.trim();
      const rawHdrs = document.getElementById('replay-headers').value;
      const body    = document.getElementById('replay-payload').value;

      let headers = {};
      try {
        headers = JSON.parse(rawHdrs);
      } catch (_) {
        _showToast('Invalid headers JSON — check the Headers textarea.');
        return;
      }

      const sendBtn = document.getElementById('replay-send');
      sendBtn.disabled    = true;
      sendBtn.textContent = 'Sending…';

      try {
        const res  = await _replayExecutor({ method, url, headers, body: body || null });
        const area = document.getElementById('replay-response-area');
        area.classList.remove('hidden');

        const badge = document.getElementById('replay-res-badge');
        badge.textContent = `${res.status}${res.statusText ? ' ' + res.statusText : ''}`;
        badge.className   = `status-badge ${_statusClass(res.status)}`;

        document.getElementById('replay-res-time').textContent = _formatTime(res.time || 0);

        const bodyPre = document.getElementById('replay-res-body');
        bodyPre.innerHTML = _looksLikeJSON(res.body || '')
          ? _highlightJSON(res.body)
          : _escHtml(res.body || '(empty)');

      } catch (err) {
        const area = document.getElementById('replay-response-area');
        area.classList.remove('hidden');
        document.getElementById('replay-res-badge').textContent = 'Error';
        document.getElementById('replay-res-badge').className   = 'status-badge s-5xx';
        document.getElementById('replay-res-time').textContent  = '';
        document.getElementById('replay-res-body').textContent  = String(err?.message || err);
      } finally {
        sendBtn.disabled  = false;
        sendBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <line x1="2" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <polyline points="9,4 13,8 9,12" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
        </svg> Send Request`;
      }
    });
  }

  /* ────────────────────────────────────────────────────────────
     Filtering
  ──────────────────────────────────────────────────────────── */

  function _matchesFilter(record, text) {
    if (!text) return true;
    const lc = text.toLowerCase();
    return (
      record.url.toLowerCase().includes(lc) ||
      record.urlPath.toLowerCase().includes(lc) ||
      record.method.toLowerCase().includes(lc)
    );
  }

  function _matchesRoutePattern(record) {
    if (!_routePattern) return true;
    try {
      const pathname = new URL(record.url).pathname;
      return _routePattern.test(pathname);
    } catch (_) {
      return _routePattern.test(record.urlPath || record.url);
    }
  }

  function _reapplyAllFilters() {
    tbody.querySelectorAll('.req-row').forEach((row) => {
      const url    = row.querySelector('.endpoint-cell')?.getAttribute('title') || '';
      const method = row.querySelector('.method-badge')?.textContent || '';
      const path   = (() => { try { return new URL(url).pathname; } catch (_) { return url; } })();

      const textMatch  = !_filterText ||
        url.toLowerCase().includes(_filterText.toLowerCase()) ||
        method.toLowerCase().includes(_filterText.toLowerCase());

      const routeMatch = !_routePattern || _routePattern.test(path);

      row.classList.toggle('filtered', !textMatch || !routeMatch);
    });
  }

  function applyFilter(text) {
    _filterText = text.trim();
    clearFilterBtn.hidden = !_filterText;
    _reapplyAllFilters();
  }

  /* ────────────────────────────────────────────────────────────
     Export dropdown
  ──────────────────────────────────────────────────────────── */

  function _initExportDropdown() {
    const exportBtn  = document.getElementById('btn-export');
    const exportMenu = document.getElementById('export-menu');

    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => exportMenu.classList.add('hidden'));

    document.getElementById('btn-export-json').addEventListener('click', () => {
      _exportCallbacks.forEach((fn) => fn('json'));
      exportMenu.classList.add('hidden');
    });

    document.getElementById('btn-export-har').addEventListener('click', () => {
      _exportCallbacks.forEach((fn) => fn('har'));
      exportMenu.classList.add('hidden');
    });
  }

  /* ────────────────────────────────────────────────────────────
     Resize handle
  ──────────────────────────────────────────────────────────── */

  function _initResize() {
    let dragging = false, startX = 0, startW = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX   = e.clientX;
      startW   = detailPanel.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.max(260, Math.min(startW + (startX - e.clientX), window.innerWidth - 240));
      detailPanel.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizeHandle.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    });
  }

  /* ────────────────────────────────────────────────────────────
     Public interface — init / addRequest / clearRequests
  ──────────────────────────────────────────────────────────── */

  function addRequest(record) {
    _allRecords.push(record);

    emptyRow.classList.add('hidden');
    _totalCount++;
    counter.textContent = `${_totalCount} captured`;

    const tr = _renderRow(record);
    tbody.appendChild(tr);

    const pane    = document.getElementById('etab-requests');
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 60;
    if (atBottom) tr.scrollIntoView({ block: 'nearest' });

    // Incrementally update the tree
    _addRecordToTree(_treeRoot, record);

    // Refresh active explorer tabs
    if (_activeEtab === 'routes') _refreshRouteTree();
    if (_activeEtab === 'audit')  _refreshHeaderAudit();
  }

  function clearRequests() {
    _allRecords.length = 0;

    tbody.querySelectorAll('.req-row').forEach((r) => r.remove());
    emptyRow.classList.remove('hidden');
    _totalCount = 0;
    counter.textContent = '0 captured';
    detailPanel.classList.add('hidden');
    _selectedRow    = null;
    _selectedRecord = null;

    // Clear route filter
    _routePattern     = null;
    _routeFilterLabel = '';
    document.getElementById('route-filter-bar').classList.add('hidden');

    // Reset tree
    _treeRoot = _newTreeNode('');
    _refreshRouteTree();
    _refreshHeaderAudit();
  }

  function init() {
    tbody          = document.getElementById('request-body');
    emptyRow       = document.getElementById('empty-row');
    counter        = document.getElementById('req-counter');
    filterInput    = document.getElementById('filter-input');
    clearFilterBtn = document.getElementById('btn-clear-filter');
    detailPanel    = document.getElementById('detail-panel');
    detailMethodBadge = document.getElementById('detail-method-badge');
    detailUrl      = document.getElementById('detail-url');
    resizeHandle   = document.getElementById('resize-handle');
    tabBtns        = document.querySelectorAll('.tab-btn');
    tabPanes       = document.querySelectorAll('.tab-pane');

    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);

    // Context menu
    _ctxMenu = document.createElement('div');
    _ctxMenu.className = 'ctx-menu hidden';
    _ctxMenu.innerHTML = '<button class="ctx-item" id="ctx-send-pentest">Send to Custom Request →</button>';
    document.body.appendChild(_ctxMenu);
    document.getElementById('ctx-send-pentest').addEventListener('click', () => {
      if (_ctxRecord) _sendToPentest(_ctxRecord);
      _ctxMenu.classList.add('hidden');
      _ctxRecord = null;
    });
    document.addEventListener('click', () => { _ctxMenu.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _ctxMenu.classList.add('hidden'); });

    // Initialise tree root
    _treeRoot = _newTreeNode('');

    filterInput.addEventListener('input', () => applyFilter(filterInput.value));
    clearFilterBtn.addEventListener('click', () => { filterInput.value = ''; applyFilter(''); });

    document.getElementById('btn-clear').addEventListener('click', () =>
      _clearCallbacks.forEach((fn) => fn())
    );

    document.getElementById('detail-close').addEventListener('click', () => {
      detailPanel.classList.add('hidden');
      if (_selectedRow) _selectedRow.classList.remove('selected');
      _selectedRow = null;
    });

    document.getElementById('btn-route-filter-clear').addEventListener('click', _clearRouteFilter);

    _initExplorerTabs();
    _initExportDropdown();
    _initResize();
    _initCookies();
  }

  /* ────────────────────────────────────────────────────────────
     Callback registration
  ──────────────────────────────────────────────────────────── */

  function onClear(fn)              { _clearCallbacks.push(fn); }
  function onExport(fn)             { _exportCallbacks.push(fn); }
  function setReplayExecutor(fn)    { _replayExecutor = fn; }
  function showToast(msg)           { _showToast(msg); }

  return { init, addRequest, clearRequests, applyFilter, onClear, onExport, setReplayExecutor, showToast };
})();

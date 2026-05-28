/* eslint-env browser, webextensions */
'use strict';

function methodClass(m) {
  return { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete', PATCH: 'patch' }[m] || 'other';
}

function statusClass(s) {
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500)             return '5xx';
  return 'other';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRecords(records) {
  const tbody   = document.getElementById('route-body');
  const counter = document.getElementById('req-counter');
  const emptyRow = document.getElementById('empty-row');

  // Remove previous data rows
  Array.from(tbody.querySelectorAll('tr.data-row')).forEach((r) => r.remove());

  counter.textContent = `${records.length} captured`;

  if (!records.length) {
    emptyRow.hidden = false;
    return;
  }
  emptyRow.hidden = true;

  const frag = document.createDocumentFragment();
  for (const r of records) {
    const tr = document.createElement('tr');
    tr.className = 'data-row';
    tr.innerHTML = `
      <td><span class="method-badge m-${esc(methodClass(r.method))}">${esc(r.method)}</span></td>
      <td title="${esc(r.url)}">
        <span class="ep-host">${esc(r.host)}</span><span class="ep-path">${esc(r.urlPath)}</span>
      </td>
      <td><span class="status-badge s-${esc(statusClass(r.status))}">${esc(String(r.status))}</span></td>
      <td class="time-cell">${esc(String(r.time))}ms</td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function load() {
  chrome.storage.session.get({ apiInspectorRecords: [] }, (data) => {
    renderRecords(data.apiInspectorRecords || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('btn-refresh').addEventListener('click', load);
});

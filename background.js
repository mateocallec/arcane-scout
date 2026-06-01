function openDocsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('docs/docs.html'), active: true });
}

chrome.runtime.onInstalled.addListener(() => {
  // Remove stale item from previous versions
  chrome.contextMenus.remove('open-api-inspector', () => chrome.runtime.lastError);
  chrome.contextMenus.create({
    id:       'open-docs',
    title:    'Arcane Scout — Help & Docs',
    contexts: ['page', 'frame'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'open-docs') return;
  openDocsPage();
});

chrome.action.onClicked.addListener(() => {
  openDocsPage();
});

// Clean up per-tab disabled-cookie state when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`ck_${tabId}`).catch(() => {});
});

// Proxy cookie API calls from devtools panel pages (Firefox restricts
// chrome.cookies.* to background scripts in that context)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getCookies') {
    chrome.cookies.getAll({ url: msg.url }, (c) => sendResponse({ cookies: c || [] }));
    return true;
  }
  if (msg.type === 'removeCookie') {
    chrome.cookies.remove({ url: msg.url, name: msg.name }, () => sendResponse({}));
    return true;
  }
  if (msg.type === 'setCookie') {
    chrome.cookies.set(msg.params, () => sendResponse({}));
    return true;
  }
});

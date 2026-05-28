function openInspectorPopup() {
  chrome.windows.create({
    url:     chrome.runtime.getURL('popup/popup.html'),
    type:    'popup',
    width:   960,
    height:  600,
    focused: true,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id:       'open-api-inspector',
    title:    'Inspect API Routes',
    contexts: ['page', 'frame'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-api-inspector') openInspectorPopup();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-api-inspector') openInspectorPopup();
});

chrome.action.onClicked.addListener(() => {
  openInspectorPopup();
});

// Clean up per-tab disabled-cookie state when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`ck_${tabId}`).catch(() => {});
});

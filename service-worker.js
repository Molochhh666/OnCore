async function configurePanelAction() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (_) {
    // The action click listener below remains the primary open path.
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !Number.isInteger(tab.id)) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(configurePanelAction);
chrome.runtime.onStartup.addListener(configurePanelAction);
configurePanelAction();

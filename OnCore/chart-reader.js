(() => {
  if (window.__oncoreChartReaderInstalled) return;
  window.__oncoreChartReaderInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'ONCORE_CAPTURE_CHART_CANVAS') return false;

    const visibleCanvases = Array.from(document.querySelectorAll('canvas'))
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        const style = window.getComputedStyle(canvas);
        return { canvas, rect, style, area: rect.width * rect.height };
      })
      .filter(({ rect, style }) => {
        return rect.width >= 280 && rect.height >= 140 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      })
      .sort((left, right) => right.area - left.area);

    const candidate = visibleCanvases[0];
    if (!candidate) return false;

    try {
      const dataUrl = candidate.canvas.toDataURL('image/png');
      sendResponse({
        ok: true,
        dataUrl,
        width: candidate.canvas.width,
        height: candidate.canvas.height,
        frameUrl: window.location.href
      });
    } catch (_) {
      sendResponse({
        ok: false,
        message: 'The Quotex chart canvas blocks direct reading. Use the screenshot review option instead.'
      });
    }
    return true;
  });
})();


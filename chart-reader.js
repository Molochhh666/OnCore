(() => {
  if (window.__oncoreChartReaderInstalled) return;
  window.__oncoreChartReaderInstalled = true;

  function looksBlank(canvas) {
    try {
      const probe = document.createElement('canvas');
      probe.width = 24;
      probe.height = 16;
      const context = probe.getContext('2d', { willReadFrequently: true });
      if (!context) return false;
      context.drawImage(canvas, 0, 0, probe.width, probe.height);
      const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
      const colors = new Set();
      let visibleDetail = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        colors.add((red >> 3) + ',' + (green >> 3) + ',' + (blue >> 3) + ',' + (alpha >> 6));
        if (alpha > 16 && (Math.max(red, green, blue) > 42 || Math.max(red, green, blue) - Math.min(red, green, blue) > 18)) {
          visibleDetail += 1;
        }
      }
      return colors.size < 4 || visibleDetail < 3;
    } catch (_) {
      return false;
    }
  }

  function captureCanvas(sendResponse) {
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

    if (!visibleCanvases.length) {
      sendResponse({ ok: false, message: 'No visible chart canvas was found on this page.' });
      return;
    }

    let blockedCanvas = false;
    for (const candidate of visibleCanvases) {
      try {
        if (looksBlank(candidate.canvas)) continue;
        const dataUrl = candidate.canvas.toDataURL('image/png');
        sendResponse({ ok: true, dataUrl, width: candidate.canvas.width, height: candidate.canvas.height });
        return;
      } catch (_) {
        blockedCanvas = true;
      }
    }

    sendResponse({
      ok: false,
      message: blockedCanvas
        ? 'Quotex blocks direct reading of this chart canvas.'
        : 'Quotex returned a blank chart canvas.'
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'ONCORE_CAPTURE_CHART_CANVAS') return false;
    requestAnimationFrame(() => requestAnimationFrame(() => captureCanvas(sendResponse)));
    return true;
  });
})();
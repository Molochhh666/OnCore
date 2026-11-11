const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODEL_ALLOWLIST = new Set(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
const MAX_ARTICLES = 4;
const QUOTEX_ORIGINS = ['https://*.quotex.com/*', 'https://*.qxbroker.com/*'];
const NEWS_CACHE_TTL_MS = 30000;
const NEWS_MIN_INTERVAL_MS = 5500;
const NEWS_RETRY_DELAY_MS = 5500;
let recentNewsCache = null;
let lastNewsRequestAt = 0;
let isBusy = false;
let liveTimer = null;
let liveAbortController = null;

const ui = {
  asset: document.getElementById('asset'),
  timeframe: document.getElementById('timeframe'),
  apiKey: document.getElementById('api-key'),
  model: document.getElementById('model'),
  consent: document.getElementById('consent'),
  analyze: document.getElementById('analyze'),
  save: document.getElementById('save-settings'),
  keyState: document.getElementById('key-state'),
  status: document.getElementById('status'),
  captureCard: document.getElementById('capture-card'),
  chartPreview: document.getElementById('chart-preview'),
  captureTime: document.getElementById('capture-time'),
  results: document.getElementById('results'),
  newsList: document.getElementById('news-list'),
  newsWindow: document.getElementById('news-window'),
  report: document.getElementById('report'),
  reportTime: document.getElementById('report-time'),
  liveInterval: document.getElementById('live-interval'),
  liveStart: document.getElementById('live-start'),
  liveStop: document.getElementById('live-stop'),
  liveState: document.getElementById('live-state')
};

function setStatus(message, kind) {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind || '';
}

function setBusy(busyNow) {
  isBusy = Boolean(busyNow);
  ui.analyze.dataset.busy = isBusy ? 'true' : 'false';
  ui.analyze.querySelector('span:nth-child(2)').textContent = isBusy ? 'Reading chart and news…' : 'Review visible-tab screenshot';
  updateButton();
}

function updateButton() {
  const busy = isBusy;
  const ready = Boolean(ui.asset.value.trim() && ui.apiKey.value.trim() && ui.consent.checked);
  ui.analyze.disabled = busy || !ready || liveTimer !== null;
  ui.liveStart.disabled = busy || !ready || liveTimer !== null;
  ui.liveStop.classList.toggle('is-hidden', liveTimer === null);
  ui.liveStart.classList.toggle('is-hidden', liveTimer !== null);
  ui.liveInterval.disabled = busy || liveTimer !== null;
  ui.liveState.textContent = liveTimer === null ? 'OFF' : 'WATCHING';
  ui.liveState.dataset.active = liveTimer !== null ? 'true' : 'false';
}

function updateKeyState() {
  const hasKey = Boolean(ui.apiKey.value.trim());
  ui.keyState.textContent = hasKey ? 'Key entered' : 'Needs Gemini API key';
  ui.keyState.style.color = hasKey ? 'var(--mint)' : '';
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiKey', 'asset', 'timeframe', 'model', 'liveInterval']);
  if (saved.apiKey) ui.apiKey.value = saved.apiKey;
  if (saved.asset) ui.asset.value = saved.asset;
  if (saved.timeframe) ui.timeframe.value = saved.timeframe;
  if (saved.model && MODEL_ALLOWLIST.has(saved.model)) ui.model.value = saved.model;
  if (saved.liveInterval && ['60000', '300000', '900000'].includes(String(saved.liveInterval))) ui.liveInterval.value = String(saved.liveInterval);
  if (!ui.model.value) ui.model.value = DEFAULT_MODEL;
  updateKeyState();
  updateButton();
}

async function saveSettings(showMessage) {
  const apiKey = ui.apiKey.value.trim();
  if (apiKey && apiKey.length > 512) {
    setStatus('That key looks too long. Check that you pasted only the Gemini API key.', 'error');
    return false;
  }
  const model = MODEL_ALLOWLIST.has(ui.model.value) ? ui.model.value : DEFAULT_MODEL;
  await chrome.storage.local.set({
    apiKey: apiKey,
    asset: ui.asset.value.trim(),
    timeframe: ui.timeframe.value,
    model: model,
    liveInterval: ui.liveInterval.value
  });
  updateKeyState();
  updateButton();
  if (showMessage) setStatus(apiKey ? 'Saved on this device. Your key is not written to a file.' : 'Asset and timeframe saved. Add a Gemini API key to analyze.', 'success');
  return true;
}

function getNewsQuery(assetInput) {
  const original = assetInput.trim();
  const compact = original.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/OTC$/, '');
  const lower = original.toLowerCase();
  const orGroup = (terms) => '(' + terms.filter(Boolean).join(' OR ') + ')';

  if (/\b(gold|xau|bullion)\b/.test(lower) || compact.includes('XAU')) return orGroup(['gold', 'bullion', 'XAU']);
  if (/\b(bitcoin|btc)\b/.test(lower) || compact.includes('BTC')) return orGroup(['"Bitcoin"', 'BTC', 'cryptocurrency']);
  if (/\b(ethereum|ether|eth)\b/.test(lower) || compact.includes('ETH')) return orGroup(['"Ethereum"', 'ETH', 'Ether']);
  if (/\b(sol|solana)\b/.test(lower) || compact.includes('SOL')) return orGroup(['Solana', 'SOL', 'cryptocurrency']);
  if (/\b(silver|xag)\b/.test(lower) || compact.includes('XAG')) return orGroup(['silver', 'bullion', 'XAG']);

  const currencies = {
    USD: ['"US dollar"', '"Federal Reserve"', 'Fed'],
    EUR: ['euro', 'ECB', '"European Central Bank"'],
    GBP: ['"British pound"', '"Bank of England"'],
    JPY: ['yen', '"Bank of Japan"'],
    CHF: ['"Swiss franc"', '"Swiss National Bank"'],
    AUD: ['"Australian dollar"', '"Reserve Bank of Australia"'],
    CAD: ['"Canadian dollar"', '"Bank of Canada"'],
    NZD: ['"New Zealand dollar"', '"Reserve Bank of New Zealand"']
  };

  const pairMatch = compact.match(/^(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)$/);
  if (pairMatch) {
    return orGroup([compact].concat(currencies[pairMatch[1]] || [], currencies[pairMatch[2]] || []));
  }

  const safePhrase = original.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safePhrase) throw new Error('Enter an asset or market name first.');
  const broadTerm = safePhrase.replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  return orGroup(['"' + safePhrase + '"', broadTerm]);
}
function parseSeenDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function isRecentArticle(article) {
  const dateText = article.seendate || article.date || article.published;
  const date = parseSeenDate(dateText);
  if (!date) return true;
  return Date.now() - new Date(date).getTime() <= 26 * 60 * 60 * 1000;
}

function getDomain(url, fallback) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); }
  catch (_) { return fallback || 'Unknown publisher'; }
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueArticles(rawArticles) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const seenDomains = new Set();
  const results = [];
  for (const article of rawArticles || []) {
    if (!article || !article.url || !article.title || !/^https?:\/\//i.test(article.url)) continue;
    if (!isRecentArticle(article)) continue;
    const urlKey = article.url.split('#')[0].replace(/\/$/, '').toLowerCase();
    const titleKey = normalizeTitle(article.title).split(' ').slice(0, 7).join(' ');
    const domain = getDomain(article.url, article.domain).toLowerCase();
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    if (seenDomains.has(domain) && results.length < 3) continue;
    seenDomains.add(domain);
    results.push({
      title: String(article.title).slice(0, 280),
      url: article.url,
      domain: getDomain(article.url, article.domain),
      seenAt: parseSeenDate(article.seendate || article.date || article.published)
    });
    if (results.length >= MAX_ARTICLES) break;
  }
  return results;
}

function waitForNewsDelay(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Live reading stopped.'));
      return;
    }
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('Live reading stopped.'));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, Math.max(0, delayMs));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchRecentArticles(asset, signal) {
  const assetKey = asset.trim().toLowerCase();
  if (recentNewsCache && recentNewsCache.assetKey === assetKey &&
      Date.now() - recentNewsCache.savedAt < NEWS_CACHE_TTL_MS) {
    return recentNewsCache.articles;
  }

  const query = getNewsQuery(asset);
  const params = new URLSearchParams({
    query: query + ' sourcelang:english',
    mode: 'artlist',
    format: 'json',
    timespan: '24h',
    maxrecords: '20',
    sort: 'datedesc'
  });
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + params.toString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal && signal.aborted) throw new Error('Live reading stopped.');
    const cooldown = NEWS_MIN_INTERVAL_MS - (Date.now() - lastNewsRequestAt);
    if (cooldown > 0) await waitForNewsDelay(cooldown, signal);
    if (signal && signal.aborted) throw new Error('Live reading stopped.');
    lastNewsRequestAt = Date.now();

    const response = await fetchWithTimeout(url, {
      headers: { 'Accept': 'application/json' }
    }, 20000, signal, 'the current-news lookup');
    const responseBody = await response.text();
    if (response.status === 429 && attempt === 0) {
      const retryAfterSeconds = Number(response.headers && response.headers.get('Retry-After'));
      const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.max(NEWS_RETRY_DELAY_MS, Math.min(30000, retryAfterSeconds * 1000))
        : NEWS_RETRY_DELAY_MS;
      await waitForNewsDelay(retryDelay, signal);
      continue;
    }
    if (!response.ok) {
      const detail = responseBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      throw new Error('The current-news feed returned HTTP ' + response.status + (detail ? ': ' + detail : '.'));
    }
    let payload;
    try {
      payload = JSON.parse(responseBody);
    } catch (_) {
      const detail = responseBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      throw new Error('The current-news feed rejected the search query' + (detail ? ': ' + detail : '.'));
    }
    if (!payload || !Array.isArray(payload.articles)) {
      throw new Error('The current-news service returned an unreadable response. No news-based analysis was made.');
    }
    const articles = uniqueArticles(payload.articles);
    recentNewsCache = { assetKey, savedAt: Date.now(), articles };
    return articles;
  }
  throw new Error('The current-news feed is still rate-limiting requests. Wait briefly, then review again.');
}
async function fetchWithTimeout(url, options, timeoutMs, externalSignal, requestLabel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } catch (error) {
    if (externalSignal && externalSignal.aborted) throw new Error('Live reading stopped.');
    if (error && error.name === 'AbortError') {
      throw new Error((requestLabel || 'The request') + ' timed out after ' + Math.round(timeoutMs / 1000) + ' seconds.');
    }
    throw new Error('Could not connect to ' + (requestLabel || 'the requested service') + '. Check your internet connection and retry.');
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
  }
}
function formatArticleDate(isoDate) {
  if (!isoDate) return 'Publication time unavailable';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoDate));
  } catch (_) {
    return isoDate;
  }
}

function renderArticles(articles, newsWarning) {
  ui.newsList.replaceChildren();
  if (!articles.length) {
    const empty = document.createElement('p');
    empty.className = 'news-empty';
    empty.textContent = newsWarning
      ? /HTTP 429/.test(newsWarning)
        ? 'News is rate-limited; chart-only decision follows.'
        : 'News unavailable; chart-only decision follows.'
      : 'No matching current news; chart-only decision follows.';
    ui.newsList.append(empty);
    return;
  }
  for (const article of articles.slice(0, MAX_ARTICLES)) {
    const link = document.createElement('a');
    link.className = 'news-item';
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noreferrer';

    const title = document.createElement('span');
    title.className = 'news-title';
    title.textContent = article.title;
    const meta = document.createElement('span');
    meta.className = 'news-meta';
    meta.textContent = 'Source ' + (ui.newsList.children.length + 1) + ' · ' + article.domain + ' · indexed ' + formatArticleDate(article.seenAt);
    link.append(title, meta);
    ui.newsList.append(link);
  }
}
async function compressScreenshot(dataUrl, captureLabel) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const limit = 1800;
  const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The screenshot could not be prepared for analysis.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const compressed = canvas.toDataURL('image/jpeg', 0.84);
  ui.chartPreview.src = compressed;
  ui.captureCard.classList.remove('is-hidden');
  ui.captureTime.textContent = (captureLabel || 'SCREENSHOT') + ' · ' + new Date().toLocaleTimeString();
  return {
    mimeType: 'image/jpeg',
    data: compressed.slice(compressed.indexOf(',') + 1)
  };
}

function buildPrompt(asset, timeframe, articles, sourceMode, newsWarning) {
  const articleList = articles.length
    ? articles.map((article, index) =>
        (index + 1) + '. ' + article.title + ' | ' + article.domain +
        ' | indexed ' + (article.seenAt || 'time unavailable') + ' | ' + article.url
      ).join('\n')
    : newsWarning
      ? 'Current news could not be loaded; use the chart only.'
      : 'No matching current articles were found.';

  const captureDescription = sourceMode === 'canvas'
    ? 'The image is the largest accessible live chart canvas.'
    : sourceMode === 'live-screenshot'
      ? 'The image is a visible-tab capture used for live chart reading.'
      : 'The image is a one-time screenshot of the visible browser tab.';
  const chartOnly = !articles.length;

  return [
    'Analyze the attached current chart and give a direction for the NEXT candle only.',
    'Asset: ' + asset + '. Candle timeframe: ' + timeframe + '. ' + captureDescription,
    'Read the latest distinguishable candles, bodies and wicks, immediate momentum, and nearby swing structure. Do not invent prices or unreadable candle details.',
    chartOnly
      ? 'No verified current news is available. Ignore the missing news and decide from the chart alone.'
      : 'Use the asset-matched article candidates below as context. Open accessible links with URL Context. If the news is irrelevant or inaccessible, decide from the chart alone.',
    'Current article candidates:',
    articleList,
    'Choose BUY or SELL only. For a clear chart, follow the stronger short-term direction. If recent candles are mixed, use the latest completed candle together with the direction of the nearest visible swing. Never claim certainty or a guaranteed outcome.',
    'Return exactly one line and nothing else: NEXT CANDLE: BUY or NEXT CANDLE: SELL. If no chart candles are actually visible, return exactly SIGNAL UNAVAILABLE. Do not add a reason, heading, markdown, duration, or any other text.'
  ].join('\n');
}

async function callGemini(apiKey, model, prompt, image, signal, useUrlContext) {
  if (!MODEL_ALLOWLIST.has(model)) throw new Error('Choose one of the supported Gemini models in AI connection settings.');
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: image.mimeType, data: image.data } }
      ]
    }],
    tools: [{ url_context: {} }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4500
    }
  };
  if (!useUrlContext) delete requestBody.tools;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  }, 90000, signal, 'Gemini analysis');
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage = payload && payload.error && payload.error.message;
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error(apiMessage || 'Gemini rejected the key or model. Check the key and selected model in AI connection.');
    }
    if (response.status === 429) throw new Error('Gemini free quota or rate limit reached. Wait for it to reset, or check your Google AI Studio usage.');
    throw new Error(apiMessage || 'Gemini returned HTTP ' + response.status + '.');
  }
  const parts = payload && payload.candidates && payload.candidates[0] &&
    payload.candidates[0].content && payload.candidates[0].content.parts;
  const reportText = Array.isArray(parts) ? parts.map((part) => part.text || '').filter(Boolean).join('\n') : '';
  if (!reportText.trim()) throw new Error('Gemini returned no readable report. Try again with a clearer chart.');
  return reportText.trim();
}

function normalizeNextCandleDecision(responseText) {
  const text = String(responseText || '');
  const labeled = text.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:NEXT CANDLE|DECISION)(?:\*\*)?\s*[:：–-]\s*(?:\*\*)?\s*(BUY|SELL)\b/i);
  if (labeled) return labeled[1].toUpperCase();

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const bare = firstLine.match(/^(?:#{1,6}\s*)?(?:\*\*)?(BUY|SELL)\b/i);
  return bare ? bare[1].toUpperCase() : '';
}

async function chartPixelFallbackDecision(image) {
  if (!image || !image.data || !image.mimeType) return '';
  try {
    const source = new Image();
    source.src = 'data:' + image.mimeType + ';base64,' + image.data;
    await source.decode();
    const width = source.naturalWidth;
    const height = source.naturalHeight;
    if (width < 120 || height < 120) return '';

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '';
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;

    const visibleTab = image.sourceMode !== 'canvas' && width / height > 1.6;
    const xStart = Math.floor(width * (visibleTab ? 0.095 : 0.035));
    const xEnd = Math.floor(width * (visibleTab ? 0.55 : 0.92));
    const yStart = Math.floor(height * (visibleTab ? 0.21 : 0.10));
    const yEnd = Math.floor(height * (visibleTab ? 0.90 : 0.92));
    const chartWidth = xEnd - xStart;
    const recentStart = Math.floor(xStart + chartWidth * 0.70);
    let redScore = 0;
    let greenScore = 0;
    let redPixels = 0;
    let greenPixels = 0;
    let latestColor = '';

    for (let x = recentStart; x < xEnd; x += 1) {
      let columnRed = 0;
      let columnGreen = 0;
      const recencyWeight = 0.65 + 0.35 * ((x - recentStart) / Math.max(1, xEnd - recentStart - 1));
      for (let y = yStart; y < yEnd; y += 1) {
        const index = (y * width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        if (red >= 135 && red - green >= 48 && red - blue >= 32) {
          columnRed += 1;
        } else if (green >= 95 && green - red >= 35 && green - blue >= 18) {
          columnGreen += 1;
        }
      }
      if (columnRed || columnGreen) {
        latestColor = columnGreen > columnRed ? 'BUY' : 'SELL';
        redPixels += columnRed;
        greenPixels += columnGreen;
        redScore += columnRed * recencyWeight;
        greenScore += columnGreen * recencyWeight;
      }
    }

    if (redPixels + greenPixels < 20) return '';
    if (Math.abs(redScore - greenScore) < 1) return latestColor;
    return greenScore > redScore ? 'BUY' : 'SELL';
  } catch (_) {
    return '';
  }
}

function getTabUrl(tab) {
  return tab && (tab.url || tab.pendingUrl) ? String(tab.url || tab.pendingUrl) : '';
}

function getTabHostname(tab) {
  try { return new URL(getTabUrl(tab)).hostname.toLowerCase(); }
  catch (_) { return ''; }
}

function isQuotexTab(tab) {
  const hostname = getTabHostname(tab);
  return hostname === 'quotex.com' || hostname.endsWith('.quotex.com') ||
    hostname === 'qxbroker.com' || hostname.endsWith('.qxbroker.com');
}

async function getActiveQuotexTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !Number.isInteger(tab.windowId)) throw new Error('Open the Quotex chart in the active browser tab first.');
  if (!getTabUrl(tab)) {
    throw new Error('Chrome still cannot read this tab address. Check that OnCore has site access for quotex.com in Chrome extension settings, then retry.');
  }
  if (!isQuotexTab(tab)) {
    const hostname = getTabHostname(tab);
    throw new Error(hostname
      ? 'The active tab is ' + hostname + '. Switch to your Quotex chart, then reopen OnCore from its toolbar icon.'
      : 'OnCore could not read the active tab address. Reopen OnCore from the Quotex toolbar tab and try again.');
  }
  return tab;
}

async function requestQuotexPageAccess() {
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: QUOTEX_ORIGINS });
  } catch (_) {
    throw new Error('Chrome could not open the Quotex permission prompt. Reload OnCore and start the review again.');
  }
  if (!granted) {
    throw new Error('Allow OnCore to access quotex.com in Chrome to read the chart, then start the review again.');
  }
}

async function captureVisibleScreenshot(captureLabel, sourceMode) {
  const tab = await getActiveQuotexTab();
  let screenshot;
  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (error) {
    const detail = error && error.message ? ' Chrome said: ' + error.message : '';
    throw new Error('Chrome could not capture the Quotex tab. Close OnCore, select the Quotex tab, then click the OnCore toolbar icon once to reopen it and grant temporary tab access.' + detail);
  }
  if (!screenshot) throw new Error('No screenshot was captured. Keep the Quotex chart visible and try again.');
  const image = await compressScreenshot(screenshot, captureLabel || 'VISIBLE TAB');
  image.sourceMode = sourceMode || 'screenshot';
  return image;
}

async function captureLiveCanvas() {
  const tab = await getActiveQuotexTab();
  let readerAttached = false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['chart-reader.js']
    });
    readerAttached = true;
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['chart-reader.js']
      });
      readerAttached = true;
    } catch (_) {
      readerAttached = false;
    }
  }

  let result = null;
  if (readerAttached) {
    try {
      result = await chrome.tabs.sendMessage(tab.id, { type: 'ONCORE_CAPTURE_CHART_CANVAS' });
    } catch (_) {
      result = null;
    }
  }
  if (result && result.ok && result.dataUrl) {
    const image = await compressScreenshot(result.dataUrl, 'LIVE CHART CANVAS');
    image.sourceMode = 'canvas';
    return image;
  }

  const reason = result && result.message ? result.message : 'The live chart canvas was blank or inaccessible.';
  try {
    setStatus(reason + ' Capturing the visible tab for this live review…', 'working');
    return await captureVisibleScreenshot('LIVE TAB FALLBACK', 'live-screenshot');
  } catch (error) {
    throw new Error(reason + ' The visible-tab fallback also failed: ' + (error.message || 'capture unavailable'));
  }
}
function stopLive(showStatus) {
  const wasRunning = liveTimer !== null;
  if (liveTimer !== null) clearInterval(liveTimer);
  liveTimer = null;
  if (liveAbortController) liveAbortController.abort();
  updateButton();
  if (showStatus && wasRunning) setStatus('Live chart reading stopped. Any current review was cancelled.', 'success');
}

async function startLive() {
  if (liveTimer !== null || isBusy) return;
  if (!ui.asset.value.trim()) {
    ui.asset.focus();
    setStatus('Enter a market or asset before starting live reading.', 'error');
    return;
  }
  if (!ui.apiKey.value.trim()) {
    document.getElementById('settings').open = true;
    ui.apiKey.focus();
    setStatus('Add a Gemini API key before starting live reading.', 'error');
    return;
  }
  if (!ui.consent.checked) {
    setStatus('Check the chart-sharing notice before starting live reading.', 'error');
    return;
  }
  try {
    await requestQuotexPageAccess();
  } catch (error) {
    setStatus(error.message || 'Quotex page access was not granted.', 'error');
    return;
  }
  await saveSettings(false);
  const interval = Math.max(60000, Number(ui.liveInterval.value) || 300000);
  liveTimer = setInterval(() => {
    if (!isBusy) analyze('canvas', true, true);
  }, interval);
  updateButton();
  setStatus('Starting live chart reading. The first canvas review is running now.', 'working');
  await analyze('canvas', true, true);
}

async function analyze(sourceMode, automatic, pageAccessReady) {
  if (isBusy) {
    if (!automatic) setStatus('Wait for the current review to finish.', 'working');
    return false;
  }
  const asset = ui.asset.value.trim();
  const apiKey = ui.apiKey.value.trim();
  const timeframe = ui.timeframe.value;
  const model = ui.model.value;
  if (!asset) {
    ui.asset.focus();
    setStatus('Enter a market or asset, such as EUR/USD, BTC/USD, or Gold.', 'error');
    return false;
  }
  if (!apiKey) {
    document.getElementById('settings').open = true;
    ui.apiKey.focus();
    setStatus('Add a Gemini API key in AI connection first.', 'error');
    return false;
  }
  if (!ui.consent.checked) {
    setStatus('Review and check the chart-sharing notice before analyzing.', 'error');
    return false;
  }

  if (!pageAccessReady) {
    try {
      await requestQuotexPageAccess();
    } catch (error) {
      setStatus(error.message || 'Quotex page access was not granted.', 'error');
      return false;
    }
  }

  const controller = new AbortController();
  liveAbortController = controller;
  setBusy(true);
  let capturedImage = null;
  ui.results.classList.add('is-hidden');
  ui.captureCard.classList.add('is-hidden');
  setStatus(sourceMode === 'canvas' ? 'Reading the visible chart canvas…' : 'Capturing the visible tab…', 'working');
  try {
    const image = sourceMode === 'canvas' ? await captureLiveCanvas() : await captureVisibleScreenshot();
    capturedImage = image;
    if (automatic && liveTimer === null) throw new Error('Live reading stopped.');
    await saveSettings(false);

    setStatus('Finding recent news about ' + asset + '…', 'working');
    let articles = [];
    let newsWarning = '';
    try {
      articles = await fetchRecentArticles(asset, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw error;
      newsWarning = error && error.message ? error.message : 'The current-news feed is unavailable.';
    }
    renderArticles(articles, newsWarning);
    ui.newsWindow.textContent = articles.length
      ? articles.length + ' SOURCES · 24H'
      : newsWarning ? 'NEWS UNAVAILABLE' : 'NO SOURCES · 24H';
    ui.results.classList.remove('is-hidden');

    ui.report.textContent = 'ANALYZING CHART…';
    ui.report.dataset.decision = 'working';
    ui.reportTime.textContent = new Date().toLocaleString();
    setStatus(newsWarning || !articles.length
      ? 'News unavailable; analyzing the chart only.'
      : 'Analyzing the current chart and article sources.', 'working');

    const effectiveMode = image.sourceMode || sourceMode;
    const report = await callGemini(apiKey, model, buildPrompt(asset, timeframe, articles, effectiveMode, newsWarning), image, controller.signal, articles.length > 0);
    let direction = normalizeNextCandleDecision(report);
    if (!direction) throw new Error('Gemini did not return a BUY or SELL direction.');
    const decision = 'NEXT CANDLE: ' + direction;
    ui.report.textContent = decision;
    ui.report.dataset.decision = direction.toLowerCase();
    ui.reportTime.textContent = new Date().toLocaleString();
    if (automatic) {
      const intervalMinutes = Math.round(Number(ui.liveInterval.value) / 60000);
      setStatus('Live review ready. Next AI review in ' + intervalMinutes + ' minute' + (intervalMinutes === 1 ? '' : 's') + '.', 'success');
    } else {
      setStatus('Review ready. Check the original chart and article sources yourself.', 'success');
    }
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : 'Analysis failed. Check the settings and retry.';
    if (capturedImage && !(controller.signal && controller.signal.aborted)) {
      const fallbackDirection = await chartPixelFallbackDecision(capturedImage);
      if (fallbackDirection) {
        const decision = 'NEXT CANDLE: ' + fallbackDirection;
        ui.report.textContent = decision;
        ui.report.dataset.decision = fallbackDirection.toLowerCase();
        ui.reportTime.textContent = new Date().toLocaleString();
        setStatus('Chart-only fallback: ' + fallbackDirection + '.', 'success');
        return true;
      }
    }
    if (ui.results && !ui.results.classList.contains('is-hidden')) {
      ui.report.textContent = 'SIGNAL UNAVAILABLE';
      ui.report.dataset.decision = 'unavailable';
    }
    if (automatic && controller.signal.aborted && liveTimer === null) {
      setStatus('Live chart reading stopped.', 'success');
    } else {
      if (automatic) stopLive(false);
      setStatus(automatic ? 'Live reading stopped: ' + message : message, 'error');
    }
    return false;
  } finally {
    if (liveAbortController === controller) liveAbortController = null;
    setBusy(false);
  }
}

ui.asset.addEventListener('input', updateButton);
ui.apiKey.addEventListener('input', () => {
  updateKeyState();
  updateButton();
});
ui.consent.addEventListener('change', updateButton);
ui.model.addEventListener('change', () => saveSettings(false));
ui.timeframe.addEventListener('change', () => saveSettings(false));
ui.liveInterval.addEventListener('change', () => saveSettings(false));
ui.save.addEventListener('click', () => saveSettings(true));
ui.analyze.addEventListener('click', () => analyze('screenshot', false, false));
ui.liveStart.addEventListener('click', startLive);
ui.liveStop.addEventListener('click', () => stopLive(true));
window.addEventListener('pagehide', () => stopLive(false));

loadSettings().catch(() => {
  setStatus('Could not load OnCore settings. Reload the extension and try again.', 'error');
});


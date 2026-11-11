const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODEL_ALLOWLIST = new Set(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
const MAX_ARTICLES = 6;
let isBusy = false;
let liveTimer = null;
let liveAbortController = null;
let lastLiveReport = '';

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
  ui.keyState.textContent = hasKey ? 'Key entered' : 'Needs a free API key';
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

  if (/\b(gold|xau|bullion)\b/.test(lower) || compact.includes('XAU')) return '"gold" OR bullion OR XAU';
  if (/\b(bitcoin|btc)\b/.test(lower) || compact.includes('BTC')) return '"Bitcoin" OR BTC OR cryptocurrency';
  if (/\b(ethereum|ether|eth)\b/.test(lower) || compact.includes('ETH')) return '"Ethereum" OR ETH OR Ether';
  if (/\b(sol|solana)\b/.test(lower) || compact.includes('SOL')) return 'Solana OR SOL OR cryptocurrency';
  if (/\b(silver|xag)\b/.test(lower) || compact.includes('XAG')) return '"silver" OR bullion OR XAG';

  const currencies = {
    USD: '"US dollar" OR Federal Reserve OR Fed',
    EUR: 'euro OR ECB OR "European Central Bank"',
    GBP: '"British pound" OR "Bank of England"',
    JPY: 'yen OR "Bank of Japan"',
    CHF: '"Swiss franc" OR "Swiss National Bank"',
    AUD: '"Australian dollar" OR "Reserve Bank of Australia"',
    CAD: '"Canadian dollar" OR "Bank of Canada"',
    NZD: '"New Zealand dollar" OR "Reserve Bank of New Zealand"'
  };

  const pairMatch = compact.match(/^(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)$/);
  if (pairMatch) {
    const pair = compact;
    const terms = [pair];
    if (currencies[pairMatch[1]]) terms.push(currencies[pairMatch[1]]);
    if (currencies[pairMatch[2]]) terms.push(currencies[pairMatch[2]]);
    return terms.join(' OR ');
  }

  const safePhrase = original.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safePhrase) throw new Error('Enter an asset or market name first.');
  return '"' + safePhrase + '" OR ' + safePhrase.replace(/[^A-Za-z0-9 ]/g, ' ').trim();
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

async function fetchRecentArticles(asset, signal) {
  const query = getNewsQuery(asset);
  const params = new URLSearchParams({
    query: query + ' sourcelang:english',
    mode: 'ArtList',
    format: 'json',
    timespan: '24h',
    maxrecords: '30',
    sort: 'DateDesc'
  });
  const response = await fetchWithTimeout('https://api.gdeltproject.org/api/v2/doc/doc?' + params.toString(), {
    headers: { 'Accept': 'application/json' }
  }, 15000, signal);
  if (!response.ok) throw new Error('The current-news feed returned HTTP ' + response.status + '.');
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.articles)) {
    throw new Error('The current-news service returned an unreadable response. No news-based analysis was made.');
  }
  return uniqueArticles(payload.articles);
}

async function fetchWithTimeout(url, options, timeoutMs, externalSignal) {
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
    if (error && error.name === 'AbortError') throw new Error('The request timed out. Please try again.');
    throw new Error('Could not connect to the news or AI service. Check your internet connection and retry.');
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

function renderArticles(articles) {
  ui.newsList.replaceChildren();
  if (!articles.length) {
    const empty = document.createElement('p');
    empty.className = 'news-empty';
    empty.textContent = 'No matching English-language stories were found in the last 24 hours. OnCore will label news coverage as unavailable and will not invent it.';
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

function buildPrompt(asset, timeframe, articles, sourceMode, previousReport) {
  const articleList = articles.length
    ? articles.map((article, index) => {
        return (index + 1) + '. ' + article.title + '\n   Publisher: ' + article.domain +
          '\n   GDELT indexed at: ' + (article.seenAt || 'not supplied') + '\n   URL: ' + article.url;
      }).join('\n')
    : 'No matching articles were found by the current-news feed.';
  const now = new Date().toISOString();

  return [
    'OnCore chart and news review. Current time: ' + now + ' (UTC).',
    'Asset supplied by user: ' + asset + '. Chart timeframe supplied by user: ' + timeframe + '.',
    '',
    sourceMode === 'canvas'
      ? 'The attached image is a live copy of the largest accessible canvas rendered on the active Quotex page. It is a visual chart image, not raw market data. Read the visible candles from left to right as far as they are individually distinguishable. Describe bullish/bearish candle color, body and wick structure, sequences, and clear formations. Do not invent OHLC values, indicators, exact levels, candle counts, or patterns that are not legible. Say plainly if the chart canvas is too small, cropped, obstructed, or too dense for a candle-by-candle read.'
      : 'The attached image is a one-time screenshot of the visible browser tab, not raw market data. Read the visible candles from left to right as far as they are individually distinguishable. Describe bullish/bearish candle color, body and wick structure, sequences, and clear formations. Do not invent OHLC values, indicators, exact levels, candle counts, or patterns that are not legible. Say plainly if the screenshot is too small, cropped, obstructed, or too dense for a candle-by-candle read.',
    '',
    'Current-news candidates returned by GDELT from its last-24-hour English-language article list (not guaranteed to be complete):',
    articleList,
    '',
    'Use the URL Context tool to open the supplied article URLs and read the accessible article content, not just titles. Report three distinct recent market-relevant events only when the source pages support them. If two sources describe the same event, treat them as one event. If fewer than three distinct items are accessible, say how many you could verify; do not fill gaps with memory or guesses. For each event give the publication time if visible, what happened in plain language, source name, and a cautious possible market relevance. Cite the candidate number and exact article title so the reader can match it to the source cards. Mark whether you could read full article text, only an excerpt, or only the title. Separate reported facts from your interpretation.',
    '',
    'Return a concise but detailed report with these plain-text headings:',
    'CHART READ',
    'VISIBLE CANDLE SEQUENCE',
    'PATTERNS AND LEVELS',
    'THREE DISTINCT NEWS EVENTS',
    'HOW CHART AND NEWS RELATE',
    'UNCERTAINTIES',
    'Under visible candle sequence, list each candle separately only when it is truly distinguishable; otherwise group an unreadable/dense section and explain why. The reported technical tilt must be descriptive (bullish pressure, bearish pressure, mixed, or unclear), not a trade instruction.',
    previousReport ? '\nPrior report from this live session (for comparison only; verify everything against the current image and articles):\n' + previousReport.slice(0, 1800) : '',
    '',
    'Do not issue buy/sell instructions, binary-option entries, expiry durations, stake sizes, confidence percentages, or executable trades. Do not imply that a pattern predicts the next price. If the picture or sources do not support a conclusion, say so directly. This is research, not a recommendation or guarantee.'
  ].join('\n');
}

async function callGemini(apiKey, model, prompt, image, signal) {
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
      maxOutputTokens: 7000
    }
  };
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  }, 90000, signal);
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

function isQuotexTab(tab) {
  let hostname = '';
  try { hostname = new URL(tab && tab.url).hostname.toLowerCase(); } catch (_) {}
  return hostname === 'quotex.com' || hostname.endsWith('.quotex.com') ||
    hostname === 'qxbroker.com' || hostname.endsWith('.qxbroker.com');
}

async function getActiveQuotexTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !Number.isInteger(tab.windowId)) throw new Error('Open the Quotex chart in the active browser tab first.');
  if (!isQuotexTab(tab)) throw new Error('Open a Quotex chart in the active tab, then try again.');
  return tab;
}

async function captureVisibleScreenshot() {
  const tab = await getActiveQuotexTab();
  let screenshot;
  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (_) {
    throw new Error('The browser could not capture this tab. Click the OnCore toolbar icon from the Quotex tab, then try again.');
  }
  if (!screenshot) throw new Error('No screenshot was captured. Keep the Quotex chart visible and try again.');
  return compressScreenshot(screenshot, 'VISIBLE TAB');
}

async function captureLiveCanvas() {
  const tab = await getActiveQuotexTab();
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['chart-reader.js']
    });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['chart-reader.js']
      });
    } catch (_) {
      throw new Error('OnCore could not attach to this Quotex page. Click its toolbar icon from the chart tab and retry.');
    }
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: 'ONCORE_CAPTURE_CHART_CANVAS' });
  } catch (_) {
    throw new Error('No accessible chart canvas was found. Reload the Quotex tab once, or use the screenshot review option.');
  }
  if (!result || !result.ok || !result.dataUrl) {
    throw new Error(result && result.message ? result.message : 'No accessible chart canvas was found. Use the screenshot review option for this chart.');
  }
  return compressScreenshot(result.dataUrl, 'LIVE CHART CANVAS');
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
  await saveSettings(false);
  lastLiveReport = '';
  const interval = Math.max(60000, Number(ui.liveInterval.value) || 300000);
  liveTimer = setInterval(() => {
    if (!isBusy) analyze('canvas', true);
  }, interval);
  updateButton();
  setStatus('Starting live chart reading. The first canvas review is running now.', 'working');
  await analyze('canvas', true);
}

async function analyze(sourceMode, automatic) {
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

  const controller = new AbortController();
  liveAbortController = controller;
  setBusy(true);
  ui.results.classList.add('is-hidden');
  ui.captureCard.classList.add('is-hidden');
  setStatus(sourceMode === 'canvas' ? 'Reading the visible chart canvas…' : 'Capturing the visible tab…', 'working');
  try {
    const image = sourceMode === 'canvas' ? await captureLiveCanvas() : await captureVisibleScreenshot();
    if (automatic && liveTimer === null) throw new Error('Live reading stopped.');
    await saveSettings(false);

    setStatus('Finding recent news about ' + asset + '…', 'working');
    const articles = await fetchRecentArticles(asset, controller.signal);
    renderArticles(articles);
    ui.newsWindow.textContent = articles.length ? articles.length + ' SOURCES · 24H' : 'NO SOURCES · 24H';
    ui.results.classList.remove('is-hidden');

    setStatus('Reading chart and accessible article pages…', 'working');
    const report = await callGemini(apiKey, model, buildPrompt(asset, timeframe, articles, sourceMode, automatic ? lastLiveReport : ''), image, controller.signal);
    ui.report.textContent = report;
    ui.reportTime.textContent = new Date().toLocaleString();
    if (automatic) {
      lastLiveReport = report;
      const intervalMinutes = Math.round(Number(ui.liveInterval.value) / 60000);
      setStatus('Live review ready. Next AI review in ' + intervalMinutes + ' minute' + (intervalMinutes === 1 ? '' : 's') + '.', 'success');
    } else {
      setStatus('Review ready. Check the original chart and article sources yourself.', 'success');
    }
    return true;
  } catch (error) {
    if (automatic && controller.signal.aborted && liveTimer === null) {
      setStatus('Live chart reading stopped.', 'success');
    } else {
      const message = error && error.message ? error.message : 'Analysis failed. Check the settings and retry.';
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
ui.analyze.addEventListener('click', () => analyze('screenshot', false));
ui.liveStart.addEventListener('click', startLive);
ui.liveStop.addEventListener('click', () => stopLive(true));
window.addEventListener('pagehide', () => stopLive(false));

loadSettings().catch(() => {
  setStatus('Could not load OnCore settings. Reload the extension and try again.', 'error');
});


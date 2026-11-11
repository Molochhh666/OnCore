# OnCore

OnCore is a Chromium side-panel extension for visual chart and current-news research. It offers two ways to provide a chart image: periodic reading of the largest accessible canvas on the active Quotex page, or a one-time capture of the visible browser tab. Its result is a one-line `NEXT CANDLE: BUY` or `NEXT CANDLE: SELL` decision. It never places or manages trades.

## Chart review modes

- **Live chart reading** injects a small reader only after you start live mode. At your chosen 1, 5, or 15 minute interval, it captures the largest visible canvas it can access from the active Quotex page. If that canvas is blank or blocked, it automatically captures the visible tab for that review. Keep the side panel open and the Quotex tab active. Each interval uses an AI request and can reach the provider's free quota.
- **Screenshot review** captures the visible tab once after you click its button. It does not capture the entire page or run repeatedly.
- If the page does not expose a readable canvas, live mode uses a visible-tab image as a fallback. The fallback can include account details visible in the browser, so hide balances and personal information before starting.

Both modes send a visual image, not raw quotes or OHLC values. They cannot promise an exact candle-by-candle reading, exact price levels, or pattern detection. The selected live interval is the AI review cadence; it does not change the chart's candle timeframe. Choose the displayed candle timeframe in the Quotex chart and set the matching timeframe in OnCore.

## Install in Chrome or Edge

1. Download this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the `OnCore` folder.
4. Open a Quotex chart and click the OnCore toolbar icon to open the side panel.
5. Enter the market or asset and the timeframe shown on the chart.
6. Expand **AI connection**, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey), paste it, and save it on this device.
7. Check the chart-sharing notice. Choose screenshot review or start live chart reading.

Supported page hosts are `quotex.com` and `qxbroker.com`. A platform layout change, protected canvas, browser restriction, or login-specific design can prevent live capture. Reload the Quotex tab after installing or updating the extension.

If screenshot capture fails, close the side panel, select the Quotex chart tab, and click the OnCore toolbar icon once to reopen it. OnCore opens the panel from that click so Chrome can grant temporary access to the active Quotex tab. The extension also requests site access only for Quotex/QXBroker when you start a review.

## News sources and AI service

OnCore searches GDELT's public English-language article index for matching articles indexed in the last 24 hours, then sends up to four candidate links to Gemini URL Context. Successful news results are cached for 30 seconds per asset; requests are spaced at least 5.5 seconds apart, and one HTTP 429 is retried after a delay. Gemini attempts to read accessible article pages as context for the one-line decision. GDELT coverage is not complete, and publishers may block full article access. If news lookup fails or returns no matching articles, OnCore asks Gemini to make a chart-only decision. It uses a local candle-color fallback if the AI request fails.

The extension has no subscription or hosted server. The news list does not require an API key. Gemini requires your own key and its free quota, model availability, and billing terms are controlled by Google and can change. Set up your Google project with the billing choices you want before using it. OnCore cannot guarantee every request will remain free.

## Accuracy and safe use

Images are not a live broker feed and do not contain exact raw prices. Candle visibility, page zoom, overlays, browser capture limits, inaccessible iframes, news coverage, and AI interpretation can all affect the review. The one-line next-candle decision is a non-binding AI estimate and can be wrong. OnCore asks Gemini to choose the stronger BUY or SELL direction from the chart when news is unavailable. A local candle-color fallback can be used if Gemini fails. Signals can be wrong; no outcome is guaranteed.

OnCore is read-only: it does not click Quotex controls or place trades. Quotex's [published trading rules](https://quotex.com/documents/en/Rules_of_Trading_operations_QTX.pdf) address automated software that performs operations without the user's direct participation. Check the platform's current rules before using any browser add-on.

## Privacy and permissions

When you analyze, OnCore sends the captured chart image, asset, timeframe, and selected article links to Google's Gemini API using your key. Google AI Studio's data use terms apply to API traffic. Hide account balances, personal information, account identifiers, and anything else you do not want to send before capturing.

The API key and basic preferences are stored in `chrome.storage.local` in this browser profile. Images and generated reports stay in the open side panel's memory and are discarded when it closes or reloads. OnCore does not send images or keys to a server it operates.

- `activeTab` lets the extension capture or access the current page after you invoke OnCore.
- `scripting` is used to add the canvas reader only when you start live mode.
- On the first review, Chrome asks for optional access to Quotex or QXBroker pages. This scoped page access lets OnCore identify the chart tab and inject the canvas reader; you can revoke it in the extension's site access settings.
- `storage` saves the API key and preferences locally in the browser profile.
- `sidePanel` displays the OnCore interface beside the chart.
- Host access is limited to GDELT's article-list API and Google's Gemini API.

There are no broker credentials, private Quotex feed interceptions, external JavaScript libraries, or automated trade actions.

## License

OnCore is covered by the MIT license at the root of this repository.


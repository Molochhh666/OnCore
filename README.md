# Signal Desk

A free, local-first forex news and chart analysis workbench. It combines public headlines with current candles, displays basic technical indicators, and withholds its directional read when the inputs are missing, stale, or disagree. It does not place or manage orders.

## Start on Windows

1. Install Python 3 if it is not already installed.
2. Install [Ollama](https://ollama.com/download) and download a local text model, for example `ollama pull qwen2.5:7b`. Smaller models may run better on lower memory PCs.
3. For a local MetaTrader 5 chart feed, install the optional adapter with `py -m pip install MetaTrader5`.
4. Copy `config.example.json` to `config.json` and choose a data source as described below. The example config includes `ollama_model`; set it to the model name available in Ollama.
5. Open MetaTrader 5 and sign in to your broker if using `mt5`.
6. Double-click `start.bat`, then open <http://127.0.0.1:8765>.

The server listens only on this PC. Do not expose it to the public internet. Headline search uses GDELT's public DOC API. News coverage and publication timing vary, and this is not a low-latency newswire.

## Market data options

### MetaTrader 5 broker candles (preferred for broker price alignment)

In `config.json`, select `mt5` and map the app's pair names to the exact symbol names your broker shows in MT5. Broker suffixes vary (for example, `EURUSD.a`), so edit the map to match your terminal:

```json
{
  "market_source": "mt5",
  "mt5_symbols": {
    "EUR/USD": "EURUSD",
    "GBP/USD": "GBPUSD",
    "USD/JPY": "USDJPY",
    "AUD/USD": "AUDUSD",
    "USD/INR": "USDINR",
    "EUR/INR": "EURINR",
    "GBP/INR": "GBPINR",
    "JPY/INR": "JPYINR"
  }
}
```

The MetaTrader terminal must be installed, open, signed in, and have the selected symbol available. This integration reads candle data only; it does not read account positions or submit orders. CSV import is available if your broker does not support MT5.

### Twelve Data FX candles

Create a free Twelve Data key, then set `market_source` to `twelve_data` and add your key in `config.json`:

```json
{
  "market_source": "twelve_data",
  "twelve_data_api_key": "YOUR_KEY"
}
```

The provider currently advertises real-time FX data on its free Basic plan with a daily request limit. Plans, supported symbols, and terms may change. Its FX spot price can differ from a broker's CFD quote or an Indian exchange currency-futures contract. Keep this config file private; Git ignores it.

### Import candles

Choose **Import candles CSV** and load a CSV with these columns: `datetime,open,high,low,close`. At least 21 rows are needed. The selected pair must match the uploaded file. Use UTC timestamps to avoid timezone confusion. A file that contains old candles will be marked stale and cannot produce a signal.

## How the read works

- News tone is a small, transparent keyword heuristic over the fetched headlines. It can misunderstand context, sarcasm, negation, or whether a story is already priced in.
- If Ollama is configured and running, a local language model classifies recent headline context for the two currencies. It sees headline text and chart indicators only. This is AI assistance, not a reliable forecast. If a model is configured but unavailable, the app withholds the signal; with no model configured it uses the clearly labelled keyword fallback.
- Chart checks use EMA 9, EMA 21, RSI 14, and ATR 14. A buy/sell bias is shown only when at least two fresh, pair-related headlines and a fresh price trend point the same way.
- The alignment score is a heuristic, not a win probability. It has not been validated as a profitable strategy.
- The exit level is an illustrative invalidation line based on the latest candle, recent swing, and 1.5 ATR. It is not a guaranteed stop price; fast moves, spread, and slippage can exceed it.
- When the market is closed, the data is stale, the source is unavailable, or news and chart disagree, the app withholds the directional read.

This is research software, not financial advice. A data API key is not a brokerage account. No live trading, order routing, position import, or automatic exits are included. The optional alert only watches a user-armed invalidation level while the app is open.

## India note

RBI guidance says residents may undertake forex transactions only with authorised persons and for permitted purposes, and electronic transactions should use RBI-authorised platforms or recognised Indian stock exchanges. Its October 10, 2026 release also changed thresholds for INR derivatives. Check the current RBI rules and your product's status before acting; this app does not determine whether a broker or trade is authorised.

## Publish on GitHub

1. Create a new repository and add the project files.
2. Never upload `config.json`, broker credentials, or private account data. `.gitignore` excludes `config.json`.
3. For a public project page, use **Settings → Pages → Deploy from a branch**. GitHub Pages can host the static UI, but the local Python server and private data keys will not run on GitHub Pages. Visitors need to run the app locally for news and market feeds.

## License

MIT. See [LICENSE](LICENSE).


# TradingGuru

TradingGuru is a free Windows app for reviewing forex headlines alongside your MetaTrader 5 chart data. It runs on your PC, uses a free local AI model, and does not place or manage trades.

## Download and start

1. Open the [TradingGuru GitHub page](https://github.com/Molochhh666/TradingGuru).
2. Click the green **Code** button, then **Download ZIP**.
3. In your Downloads folder, right-click the ZIP and choose **Extract All**.
4. Open the extracted folder and double-click **TradingGuru.bat**.

The first run sets up the app for you. It creates private settings on your PC, installs the MetaTrader 5 data connector, and downloads the local AI model (about 2 GB). Keep the black setup window open while it works. It will open TradingGuru in your browser when ready. Leave that window open while using the app; close it to stop TradingGuru.

### One-time installs

The start file checks for the two free programs the app needs. If one is missing, it opens that program's official download page:

- [Python for Windows](https://www.python.org/downloads/windows/) — install Python 3, then run **TradingGuru.bat** again.
- [Ollama for Windows](https://ollama.com/download/windows) — install Ollama, then run **TradingGuru.bat** again.

Keep an internet connection during the first setup so the connector and AI model can download. Later starts skip setup work that is already complete.

## Use your MT5 chart

Open MetaTrader 5, sign in to your broker, and make sure the currency pair you want is visible in the terminal. Then start TradingGuru. The default configuration reads candles from that local MT5 terminal. It does not read your account balance or positions, and it cannot send orders.

If the app says a broker symbol is unavailable, your broker may use a suffix such as `EURUSD.a` instead of `EURUSD`. Check the exact symbol name in MT5; the pair mapping is in the private `config.json` file beside the app. You can ask for help adjusting it.

The app can also import a candle CSV with these columns: `datetime,open,high,low,close`. Use UTC timestamps and at least 21 rows.

## What the app shows

- Public headlines from GDELT. It searches headlines, not full articles, and is not a low-latency news service.
- Broker candles and bid/ask data from your local MT5 terminal.
- A local AI classification and chart indicators (EMA 9, EMA 21, RSI 14, and ATR 14).
- A BUY BIAS or SELL BIAS only when recent news and fresh chart data agree. Otherwise, it shows WAIT.
- An optional exit-level alert while the app is open. The alert cannot close a trade.

Signals are experimental analysis, not a promise of profit or financial advice. News can be misread or already priced in; prices can move quickly. The alignment score is not a probability of winning, and an alert level is not a guaranteed execution price. Check the original news and your broker before making decisions.

## Privacy and cost

The app and local AI model are free. Headlines are requested from GDELT over the internet; chart data comes from your local MT5 terminal. The AI analysis runs through Ollama on your PC. Do not put broker passwords or account credentials in the app. A local `config.json` is created on first start and is excluded from GitHub.

## License

MIT. See [LICENSE](LICENSE).


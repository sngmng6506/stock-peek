# Stock Peek (몰래주식)

> Free, open-source desktop widget for Windows and Mac that shows US, Korean, Japanese, Indian and Saudi watchlist quotes when you move the mouse to the screen edge. No account, no ads, no brokerage connection. Current version: v{{version}}.

Stock Peek lives in the system tray (menu bar on Mac). Moving the cursor to the left or right screen edge slides in a panel with the watchlist: price, daily change, a three-month daily chart, and profit and loss when shares and average price are entered. Moving the cursor away hides it.

Key facts:

- Platforms: Windows 10 and 11; macOS 12 or later (universal build)
- Price and license: free, MIT License
- Markets: Korean stocks (KOSPI, KOSDAQ), US stocks and ETFs (NYSE, NASDAQ), Japanese stocks and ETFs (Tokyo Stock Exchange), Indian stocks (NSE), Saudi stocks (Tadawul)
- Quote sources: Naver Finance for Korean stocks; Yahoo Finance for US, Japanese, Indian and Saudi stocks. Japanese quotes are delayed 20 minutes and Saudi quotes 15 minutes; NSE quotes are real-time. Japanese names and search come from the JPX listed-issues list, updated monthly
- Refresh: every 3 seconds while a watched market is open, every 60 seconds otherwise
- Languages: Korean, English, Japanese, Arabic (app and website)
- Data: watchlist, holdings and settings stay on the user's computer. The only network requests are for quotes and update checks. No analytics or advertising SDKs
- Corporate networks: uses the system proxy and certificates, so it usually works behind company proxies; install permissions may still block it
- Installation warnings: the app is not code-signed. Windows SmartScreen shows a warning ("More info" → "Run anyway"). On Mac the first launch must be allowed in System Settings → Privacy & Security ("Open Anyway")
- Updates: checked at launch, hourly, when the panel opens, and from Settings. Windows installs after a notification click; Mac opens the download page
- Limitation: quotes may be delayed and are not official execution data or investment advice

## Pages

{{pages}}

## Downloads

- [Windows installer](https://github.com/sngmng6506/stock-peek/releases/latest/download/stock-peek-setup.exe): latest .exe
- [Mac disk image](https://github.com/sngmng6506/stock-peek/releases/latest/download/stock-peek-mac.dmg): latest .dmg
- [GitHub releases](https://github.com/sngmng6506/stock-peek/releases): all versions with SHA256SUMS.txt and SHA256SUMS-mac.txt

## Optional

- [Source code](https://github.com/sngmng6506/stock-peek): Electron + React, MIT License

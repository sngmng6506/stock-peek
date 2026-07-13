# Privacy and data handling

Stock Peek does not require an account and does not connect to a brokerage account or place orders.

## Stored on your PC

The following data is stored locally through `electron-store`:

- watchlist symbols and order
- holding quantity and average purchase price
- dock position and selected monitor
- language and welcome-screen preferences
- a randomly generated device identifier used for the daily portfolio review limit

## Network requests

The app requests public market data from the Stock Peek Cloudflare Worker and, if needed, directly from Naver Finance or Yahoo Finance.

When you explicitly use the **portfolio one-line review** feature, the app sends these values to the Stock Peek Worker:

- a randomly generated device identifier
- calculated portfolio statistics
- selected language

The identifier is used to enforce the feature's daily usage limit. Raw brokerage credentials are never requested because the app does not connect to a brokerage account.

## Analytics and advertising

The desktop app does not include advertising SDKs or general-purpose behavioral analytics.

## Contact

For privacy questions, contact sngmng6506@gmail.com.

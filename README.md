# Haze Tracker

A Progressive Web App showing Singapore's **24-hr PSI** and **1-hr PM2.5** for the Central, North, South, East and West regions plus the national figure, using NEA's real-time data from [data.gov.sg](https://data.gov.sg).

- Add to Home Screen on iOS (Safari → Share → Add to Home Screen) or Android (Chrome → Install app).
- Pick a region and a PSI threshold; you get a notification when that region's 24-hr PSI reaches the threshold, once per crossing.
- Works offline with the last saved reading.

## Run / host

It is a static site with no build step. Serve the folder over HTTPS (service workers and notifications need it), for example with GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. Locally: `python3 -m http.server` and open `http://localhost:8000`.

## Notes and limits

- **"1-hour PSI":** NEA publishes the PSI as a 24-hour index. The hourly figure it publishes is PM2.5, so that is what the 1-hr line shows.
- **Alerts have no server behind them.** They are checked while the app is open, and by Chrome on Android's periodic background sync when the app is installed (timing is up to the browser). Alerts that arrive while the app is fully closed on iPhone would need a push server.
- Endpoints used: `https://api-open.data.gov.sg/v2/real-time/api/psi` and `.../pm25`. If you hit rate limits, paste a free data.gov.sg API key under *Advanced*; it is stored only on your device.

Data: National Environment Agency, Singapore Open Data Licence.

# 🧣 What to Wear?

A cute, minimal mobile web app that tells you what to wear based on the live weather at your location.

## Features

- 📍 Detects your location via the browser Geolocation API, with a manual place search fallback
- 🌤️ Live weather from [Open-Meteo](https://open-meteo.com/) (free, no API key)
- 🧥 Cheeky clothing advice for each part of the day — morning (6–12), afternoon (12–6) and evening (6–11pm) — dressed for the coldest feels-like (wind chill included) and worst rain/wind in each block
- 👉 Swipe right (or tap the tab) for tomorrow's forecast and advice; swipe left to come back
- 🎚️ Adjustable comfort thresholds, saved on your device (localStorage)
- 📱 Mobile-first, single screen, no build step — plain HTML/CSS/JS

## Default thresholds (all adjustable in-app)

| Recommendation | Trigger |
| --- | --- |
| Heavy coat | feels-like < 5°C |
| Light jacket | feels-like 5–12°C |
| Layers / jumper | feels-like 12–18°C |
| Umbrella / rain gear | rain falling, rain chance ≥ 40%, or paired with wind > 20 km/h |
| Hat, gloves & scarf | feels-like < 2°C or significant wind chill |

## Run locally

Serve the folder with any static server, e.g.:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. (Geolocation requires `localhost` or HTTPS.)

## Credits

Weather data by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Reverse geocoding by [BigDataCloud](https://www.bigdatacloud.com/)'s free client API.

"use strict";

/* ---------- settings (thresholds) ---------- */

const DEFAULTS = {
  heavyCoat: 5,   // feels-like below this → heavy coat (°C)
  jacket: 12,     // feels-like below this → light jacket (°C)
  layers: 18,     // feels-like below this → jumper/layers (°C)
  hatGloves: 2,   // feels-like below this → hat, gloves, scarf (°C)
  windy: 20,      // wind above this is "too windy" (km/h)
  rainProb: 40,   // rain chance above this → bring rain gear (%)
};

const SETTING_META = [
  { key: "heavyCoat", label: "🧥 Heavy coat below", unit: "°C", min: -10, max: 15 },
  { key: "jacket", label: "🧥 Light jacket below", unit: "°C", min: 0, max: 20 },
  { key: "layers", label: "🧶 Layers below", unit: "°C", min: 5, max: 28 },
  { key: "hatGloves", label: "🧤 Hat & gloves below", unit: "°C", min: -15, max: 10 },
  { key: "windy", label: "🌬️ Windy above", unit: "km/h", min: 5, max: 60 },
  { key: "rainProb", label: "☔ Rain alert above", unit: "%", min: 0, max: 100 },
];

const SETTINGS_KEY = "wearcast.settings";
const PLACE_KEY = "wearcast.place";

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

let settings = { ...DEFAULTS, ...(loadJSON(SETTINGS_KEY) || {}) };
let place = loadJSON(PLACE_KEY); // { lat, lon, name }
let weather = null;

/* ---------- dom helpers ---------- */

const $ = (id) => document.getElementById(id);

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

/* ---------- weather codes (WMO) ---------- */

function codeInfo(code, isDay) {
  const sun = isDay ? "☀️" : "🌙";
  const partly = isDay ? "⛅" : "☁️";
  const map = [
    [[0], [sun, "Clear sky"]],
    [[1], [sun, "Mostly clear"]],
    [[2], [partly, "Partly cloudy"]],
    [[3], ["☁️", "Overcast"]],
    [[45, 48], ["🌫️", "Foggy"]],
    [[51, 53, 55, 56, 57], ["🌦️", "Drizzle"]],
    [[61, 63, 66, 80, 81], ["🌧️", "Rain"]],
    [[65, 67, 82], ["🌧️", "Heavy rain"]],
    [[71, 73, 75, 77, 85, 86], ["🌨️", "Snow"]],
    [[95, 96, 99], ["⛈️", "Thunderstorm"]],
  ];
  for (const [codes, info] of map) if (codes.includes(code)) return { emoji: info[0], label: info[1] };
  return { emoji: "🌡️", label: "Weather" };
}

const RAINY_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const SNOWY_CODES = [71, 73, 75, 77, 85, 86];

/* ---------- recommendations ---------- */

function buildRecs(w, s) {
  const recs = [];
  const add = (emoji, text) => recs.push({ emoji, text });
  const feels = w.feels;

  // coat / jacket / layers
  if (feels < s.heavyCoat) add("🧥", "Bundle up in a heavy coat");
  else if (feels < s.jacket) add("🧥", "A light jacket will do");
  else if (feels < s.layers) add("🧶", "Layer up — grab a jumper");
  else add("😎", "No jacket needed — dress light");

  // rain gear
  const rainNow = w.precip > 0 || RAINY_CODES.includes(w.code);
  const rainSoon = w.rainProb >= s.rainProb;
  if (rainNow || rainSoon) {
    if (w.wind > s.windy) add("🧥💧", "Too windy for an umbrella — wear a rain jacket");
    else add("☂️", rainNow ? "Take an umbrella — it's wet out there" : "Take an umbrella, rain is likely");
  } else if (w.wind > s.windy) {
    add("🌬️", "Blustery! A windproof layer helps");
  }

  // hat / gloves / scarf
  const windChill = w.temp - feels; // how much colder it feels than it is
  if (feels < s.hatGloves) add("🧤", "Hat, gloves and a scarf");
  else if (windChill >= 4 && feels < s.jacket) add("🧣", "Biting wind chill — add a hat or scarf");

  // little extras
  if (SNOWY_CODES.includes(w.code)) add("👢", "Snow underfoot — waterproof boots");
  if (w.code <= 1 && w.isDay && feels >= s.layers) add("🧢", "Sunny — cap and sunscreen");

  return recs;
}

/* ---------- rendering ---------- */

function showLoading(msg) {
  $("stateEmoji").textContent = "🔭";
  $("stateMsg").textContent = msg;
  hide($("stateActions"));
  show($("stateCard"));
}

function showWelcome(msg, emoji = "👋") {
  $("stateEmoji").textContent = emoji;
  $("stateMsg").textContent = msg;
  show($("stateActions"));
  show($("stateCard"));
  hide($("weatherCard"));
  hide($("recsCard"));
}

function renderWeather() {
  if (!weather) return;
  const w = weather;
  const info = codeInfo(w.code, w.isDay);

  $("wxEmoji").textContent = info.emoji;
  $("wxTemp").textContent = `${Math.round(w.temp)}°`;
  $("wxCond").textContent = info.label;
  $("wxFeels").textContent = `Feels like ${Math.round(w.feels)}°`;
  $("wxWind").textContent = `${Math.round(w.wind)} km/h`;
  $("wxHumidity").textContent = `${Math.round(w.humidity)}%`;
  $("wxRain").textContent = `${Math.round(w.rainProb)}%`;

  const list = $("recsList");
  list.innerHTML = "";
  for (const rec of buildRecs(w, settings)) {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "rec-emoji";
    badge.textContent = rec.emoji;
    li.append(badge, document.createTextNode(rec.text));
    list.append(li);
  }

  const t = new Date();
  $("updatedAt").textContent =
    `Updated ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · `;

  hide($("stateCard"));
  show($("weatherCard"));
  show($("recsCard"));
}

/* ---------- data fetching ---------- */

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWeather() {
  if (!place) return;
  showLoading("Checking the sky… 🌤️");
  hide($("weatherCard"));
  hide($("recsCard"));
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day" +
      "&hourly=precipitation_probability&forecast_hours=6&timezone=auto";
    const data = await fetchJSON(url);
    const c = data.current;
    const probs = data.hourly?.precipitation_probability?.filter((p) => p != null) ?? [];
    weather = {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precip: c.precipitation,
      code: c.weather_code,
      wind: c.wind_speed_10m,
      isDay: c.is_day === 1,
      rainProb: probs.length ? Math.max(...probs) : 0,
    };
    renderWeather();
  } catch (err) {
    console.error(err);
    showWelcome("Couldn't fetch the weather. Check your connection and try again?", "🙈");
  }
}

function setPlace(p) {
  place = p;
  localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  $("locationName").textContent = p.name;
  closeSheet("locationSheet");
  fetchWeather();
}

async function reverseGeocode(lat, lon) {
  // free, no-key reverse geocoding for a friendly place name
  try {
    const d = await fetchJSON(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    return d.city || d.locality || d.principalSubdivision || d.countryName || "Your location";
  } catch {
    return "Your location";
  }
}

function useGeolocation() {
  if (!navigator.geolocation) {
    showWelcome("Your browser can't share location — search for your town instead!", "🗺️");
    openSheet("locationSheet");
    return;
  }
  showLoading("Finding you… 📍");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = +pos.coords.latitude.toFixed(4);
      const lon = +pos.coords.longitude.toFixed(4);
      $("locationName").textContent = "Found you!";
      const name = await reverseGeocode(lat, lon);
      setPlace({ lat, lon, name });
    },
    () => {
      $("locationName").textContent = "Choose a place";
      showWelcome("No worries — tell me where you are instead!", "🗺️");
    },
    { timeout: 10000, maximumAge: 5 * 60 * 1000 }
  );
}

async function searchPlaces(query) {
  const list = $("searchResults");
  list.innerHTML = "<li class='none'>Searching… 🔎</li>";
  try {
    const d = await fetchJSON(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
    );
    list.innerHTML = "";
    if (!d.results?.length) {
      list.innerHTML = "<li class='none'>Nothing found — try another spelling?</li>";
      return;
    }
    for (const r of d.results) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      const region = [r.admin1, r.country].filter(Boolean).join(", ");
      btn.innerHTML = `${r.name} <span class="muted">${region}</span>`;
      btn.addEventListener("click", () =>
        setPlace({ lat: r.latitude, lon: r.longitude, name: r.name })
      );
      li.append(btn);
      list.append(li);
    }
  } catch {
    list.innerHTML = "<li class='none'>Search failed — are you online?</li>";
  }
}

/* ---------- sheets ---------- */

function openSheet(id) { show($(id)); }
function closeSheet(id) { hide($(id)); }

/* ---------- settings UI ---------- */

function renderSettingsRows() {
  const wrap = $("settingsRows");
  wrap.innerHTML = "";
  for (const meta of SETTING_META) {
    const row = document.createElement("div");
    row.className = "setting-row";

    const top = document.createElement("div");
    top.className = "setting-top";
    const label = document.createElement("label");
    label.textContent = meta.label;
    label.htmlFor = `set-${meta.key}`;
    const out = document.createElement("output");
    out.textContent = `${settings[meta.key]} ${meta.unit}`;
    top.append(label, out);

    const input = document.createElement("input");
    input.type = "range";
    input.id = `set-${meta.key}`;
    input.min = meta.min;
    input.max = meta.max;
    input.step = 1;
    input.value = settings[meta.key];
    input.addEventListener("input", () => {
      settings[meta.key] = +input.value;
      out.textContent = `${settings[meta.key]} ${meta.unit}`;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      renderWeather(); // live-update recommendations
    });

    row.append(top, input);
    wrap.append(row);
  }
}

/* ---------- wiring ---------- */

function init() {
  renderSettingsRows();

  $("settingsBtn").addEventListener("click", () => openSheet("settingsSheet"));
  $("locationPill").addEventListener("click", () => openSheet("locationSheet"));
  $("refreshBtn").addEventListener("click", fetchWeather);
  $("geoBtn").addEventListener("click", () => { closeSheet("locationSheet"); useGeolocation(); });
  $("stateGeoBtn").addEventListener("click", useGeolocation);
  $("stateSearchBtn").addEventListener("click", () => openSheet("locationSheet"));

  $("resetBtn").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    renderSettingsRows();
    renderWeather();
  });

  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("searchInput").value.trim();
    if (q) searchPlaces(q);
  });

  // tap backdrop or close button to dismiss sheets
  for (const sheet of document.querySelectorAll(".sheet-backdrop")) {
    sheet.addEventListener("click", (e) => { if (e.target === sheet) hide(sheet); });
  }
  for (const btn of document.querySelectorAll(".sheet-close")) {
    btn.addEventListener("click", () => closeSheet(btn.dataset.close));
  }

  // start: saved place → fetch; otherwise try geolocation
  if (place) {
    $("locationName").textContent = place.name;
    fetchWeather();
  } else {
    useGeolocation();
  }
}

init();

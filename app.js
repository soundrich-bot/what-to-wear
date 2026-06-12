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
let data = null;                 // parsed Open-Meteo payload
let view = 0;                    // 0 = today, 1 = tomorrow

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

// how grim is this weather code? used to pick a segment's headline conditions
function severity(code) {
  if ([95, 96, 99].includes(code)) return 8;
  if ([65, 67, 82].includes(code)) return 7;
  if (SNOWY_CODES.includes(code)) return 6;
  if ([61, 63, 66, 80, 81].includes(code)) return 5;
  if ([51, 53, 55, 56, 57].includes(code)) return 4;
  if ([45, 48].includes(code)) return 3;
  return code === 3 ? 2 : code === 2 ? 1 : 0;
}

/* ---------- recommendations ---------- */

function buildRecs(w, s) {
  const recs = [];
  const add = (emoji, text) => recs.push({ emoji, text });
  const feels = w.feels; // apparent temperature: wind chill already baked in

  // coat / jacket / layers
  if (feels < s.heavyCoat) add("🧥", "Big coat. It's proper baltic out");
  else if (feels < s.jacket) add("🧥", "Jacket weather — chuck one on");
  else if (feels < s.layers) add("🧶", "Jumper o'clock. Layer up");
  else add("😎", "Skip the jacket, you'll live");

  // rain gear
  const rainNow = w.precip > 0 || RAINY_CODES.includes(w.code);
  const rainSoon = w.rainProb >= s.rainProb;
  if (rainNow || rainSoon) {
    if (w.wind > s.windy) add("🧥💧", "A brolly would die out there — rain jacket");
    else add("☂️", rainNow ? "It's chucking it down — take the brolly" : "The sky's plotting something — pack a brolly");
  } else if (w.wind > s.windy) {
    add("🌬️", "Blowy. Hold onto your hat");
  }

  // hat / gloves / scarf
  const windChill = w.temp - feels; // how much colder the wind makes it feel
  if (feels < s.hatGloves) add("🧤", "Hat, gloves, scarf — full granny mode");
  else if (windChill >= 4 && feels < s.jacket) add("🧣", "Wind chill's got knives — add a scarf");

  // little extras
  if (SNOWY_CODES.includes(w.code)) add("👢", "Snow. Boots, unless you fancy wet socks");
  if (w.code <= 1 && w.isDay && feels >= s.layers) add("🧢", "Sun's out — cap and sunscreen, don't go crispy");

  return recs;
}

/* ---------- day segments ---------- */

const SEGMENTS = [
  { name: "Morning", emoji: "🌅", from: 6, to: 11 },   // 6am–noon
  { name: "Afternoon", emoji: "☀️", from: 12, to: 17 }, // noon–6pm
  { name: "Evening", emoji: "🌆", from: 18, to: 22 },   // 6pm–11pm
];

const hourOf = (t) => +t.slice(11, 13);
const dateOf = (t) => t.slice(0, 10);

// aggregate hourly data into morning/afternoon/evening blocks for day 0 or 1;
// for today, hours already gone are dropped (dress for what's left of the day)
function segmentsFor(dayIdx) {
  const date = data.daily.time[dayIdx];
  const isToday = dateOf(data.current.time) === date;
  const nowH = hourOf(data.current.time);
  const h = data.hourly;
  const out = [];

  for (const sg of SEGMENTS) {
    const idxs = [];
    h.time.forEach((t, i) => {
      if (dateOf(t) !== date) return;
      const hr = hourOf(t);
      if (hr >= sg.from && hr <= sg.to && (!isToday || hr >= nowH)) idxs.push(i);
    });
    if (!idxs.length) continue; // segment fully in the past

    // dress for the coldest hour; plan for the worst wind/rain
    let coldest = idxs[0];
    for (const i of idxs) if (h.apparent_temperature[i] < h.apparent_temperature[coldest]) coldest = i;

    out.push({
      ...sg,
      w: {
        temp: h.temperature_2m[coldest],
        feels: h.apparent_temperature[coldest],
        wind: Math.max(...idxs.map((i) => h.wind_speed_10m[i])),
        precip: idxs.reduce((sum, i) => sum + (h.precipitation[i] || 0), 0),
        rainProb: Math.max(...idxs.map((i) => h.precipitation_probability[i] ?? 0)),
        code: idxs.map((i) => h.weather_code[i]).reduce((a, b) => (severity(b) > severity(a) ? b : a)),
        isDay: h.is_day[idxs[Math.floor(idxs.length / 2)]] === 1,
      },
    });
  }
  return out;
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

function renderRecs() {
  $("recsTitle").textContent = view === 0 ? "Today's plan of attack" : "Tomorrow's plan of attack";
  const body = $("recsBody");
  body.innerHTML = "";

  const segs = segmentsFor(view);
  if (!segs.length) {
    const p = document.createElement("p");
    p.className = "after-hours";
    p.textContent = "🛌 It's past 11pm. Pyjamas. Swipe for tomorrow.";
    body.append(p);
    return;
  }

  for (const sg of segs) {
    const head = document.createElement("div");
    head.className = "segment-head";
    const meta = `feels ${Math.round(sg.w.feels)}° · ${Math.round(sg.w.rainProb)}% rain`;
    head.innerHTML = `<span>${sg.emoji} ${sg.name}</span><span class="segment-meta">${meta}</span>`;

    const ul = document.createElement("ul");
    ul.className = "rec-list";
    for (const rec of buildRecs(sg.w, settings)) {
      const li = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = "rec-emoji";
      badge.textContent = rec.emoji;
      li.append(badge, document.createTextNode(rec.text));
      ul.append(li);
    }
    body.append(head, ul);
  }
}

function renderConditions() {
  if (view === 0) {
    const c = data.current;
    const info = codeInfo(c.weather_code, c.is_day === 1);
    $("wxEmoji").textContent = info.emoji;
    $("wxTemp").textContent = `${Math.round(c.temperature_2m)}°`;
    $("wxCond").textContent = info.label;
    $("wxFeels").textContent = `Feels like ${Math.round(c.apparent_temperature)}°`;
    $("wxWind").textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    $("wxWindLabel").textContent = "wind";
    $("wxMidIco").textContent = "💧";
    $("wxMid").textContent = `${Math.round(c.relative_humidity_2m)}%`;
    $("wxMidLabel").textContent = "humidity";
    // rain chance over the next 6 hours
    const nowIdx = data.hourly.time.findIndex((t) => t === data.current.time.slice(0, 13) + ":00");
    const next6 = data.hourly.precipitation_probability
      .slice(Math.max(nowIdx, 0), Math.max(nowIdx, 0) + 6)
      .filter((p) => p != null);
    $("wxRain").textContent = `${next6.length ? Math.max(...next6) : 0}%`;
    $("wxRainLabel").textContent = "rain next 6h";
  } else {
    const d = data.daily;
    const info = codeInfo(d.weather_code[1], true);
    $("wxEmoji").textContent = info.emoji;
    $("wxTemp").textContent = `${Math.round(d.temperature_2m_max[1])}° / ${Math.round(d.temperature_2m_min[1])}°`;
    $("wxCond").textContent = info.label;
    $("wxFeels").textContent = `Feels like ${Math.round(d.apparent_temperature_min[1])}° at the worst of it`;
    $("wxWind").textContent = `${Math.round(d.wind_speed_10m_max[1])} km/h`;
    $("wxWindLabel").textContent = "top wind";
    $("wxMidIco").textContent = "🥶";
    $("wxMid").textContent = `${Math.round(d.apparent_temperature_min[1])}°`;
    $("wxMidLabel").textContent = "feels at worst";
    $("wxRain").textContent = `${Math.round(d.precipitation_probability_max[1] ?? 0)}%`;
    $("wxRainLabel").textContent = "rain chance";
  }
  $("wxTemp").classList.toggle("range", view === 1);
}

function renderView() {
  if (!data) return;

  $("tabToday").classList.toggle("active", view === 0);
  $("tabTomorrow").classList.toggle("active", view === 1);
  $("tabToday").setAttribute("aria-selected", view === 0);
  $("tabTomorrow").setAttribute("aria-selected", view === 1);

  renderRecs();
  renderConditions();

  const t = new Date();
  $("updatedAt").textContent =
    `Updated ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · `;

  hide($("stateCard"));
  show($("recsCard"));
  show($("weatherCard"));
}

function setView(v) {
  if (!data || v === view) return;
  view = v;
  renderView();
  // little slide nudge so the swap is visible
  for (const id of ["recsCard", "weatherCard"]) {
    const el = $(id);
    el.classList.remove("swap-left", "swap-right");
    void el.offsetWidth; // restart animation
    el.classList.add(v === 1 ? "swap-left" : "swap-right");
  }
}

/* ---------- data fetching ---------- */

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWeather() {
  if (!place) return;
  showLoading("Interrogating the sky… 🌤️");
  hide($("weatherCard"));
  hide($("recsCard"));
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day" +
      "&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,precipitation_probability_max,wind_speed_10m_max" +
      "&forecast_days=2&timezone=auto";
    data = await fetchJSON(url);
    renderView();
  } catch (err) {
    console.error(err);
    showWelcome("The weather machine said no. Internet okay?", "🙈");
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
    showWelcome("Your browser won't say where you are. Type it in, old-school.", "🗺️");
    openSheet("locationSheet");
    return;
  }
  showLoading("Hunting you down… 📍");
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
      showWelcome("Fine, keep your secrets. Where are you, then?", "🗺️");
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
      list.innerHTML = "<li class='none'>Never heard of it. Try another spelling?</li>";
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
      renderView(); // live-update recommendations
    });

    row.append(top, input);
    wrap.append(row);
  }
}

/* ---------- swipe ---------- */

function wireSwipe() {
  let startX = 0, startY = 0, tracking = false;

  document.addEventListener("touchstart", (e) => {
    if (e.target.closest(".sheet-backdrop")) return; // don't fight sliders/sheets
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
    if (dx > 0) setView(1); // swipe right → tomorrow
    else setView(0);        // swipe left → back to today
  }, { passive: true });
}

/* ---------- wiring ---------- */

function init() {
  renderSettingsRows();
  wireSwipe();

  $("settingsBtn").addEventListener("click", () => openSheet("settingsSheet"));
  $("locationPill").addEventListener("click", () => openSheet("locationSheet"));
  $("refreshBtn").addEventListener("click", fetchWeather);
  $("geoBtn").addEventListener("click", () => { closeSheet("locationSheet"); useGeolocation(); });
  $("stateGeoBtn").addEventListener("click", useGeolocation);
  $("stateSearchBtn").addEventListener("click", () => openSheet("locationSheet"));
  $("tabToday").addEventListener("click", () => setView(0));
  $("tabTomorrow").addEventListener("click", () => setView(1));

  $("resetBtn").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    renderSettingsRows();
    renderView();
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

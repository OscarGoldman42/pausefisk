import "@fontsource-variable/inter";
import { createSound } from "./sound.js";

// Farven glider fra den valgte farve til orange over de sidste minutter (eller hele perioden hvis den er kortere).
// Orange og rød er ikke med som valg, fordi de betyder "tiden er ved at løbe ud".
const FADE_WINDOW_MS = 5 * 60 * 1000;
const CLOCK_COLORS = {
  hvid: ["Hvid", [255, 255, 255]],
  turkis: ["Turkis", [110, 231, 240]],
  mint: ["Mint", [150, 240, 185]],
  gul: ["Gul", [255, 224, 102]],
  lyseroed: ["Lyserød", [255, 160, 205]],
  lavendel: ["Lavendel", [195, 180, 255]],
};
const ORANGE = [255, 140, 30];
const RED = "#ff3b30";
const IDLE_MS = 2500;

const setup = document.getElementById("setup");
const minutesInput = document.getElementById("minutes");
const clock = document.getElementById("clock");
const timeEl = document.getElementById("time");
const subtitleEl = document.getElementById("subtitle");
const help = document.getElementById("help");
const deadFishInput = document.getElementById("dead-fish");
const messageInput = document.getElementById("message");
const messageText = document.getElementById("message-text");
const clockSizeInput = document.getElementById("clock-size");
const timeThemeInput = document.getElementById("time-theme");
const aquariumHelp = document.getElementById("aquarium-help");
const cornerInput = document.getElementById("corner-clock");
const CORNER_UNTIL_MS = 5 * 60_000; // uret bliver stort igen, når der er 5 minutter tilbage
const DIGITS_MS = 10_000; // de sidste 10 sekunder tæller fiskene ned
let aquariumOnly = false;
const soundInput = document.getElementById("sound");
const sound = createSound();

function rememberSelect(input, key, fallback) {
  try {
    input.value = localStorage.getItem(key) ?? fallback;
  } catch {
    input.value = fallback;
  }
  input.addEventListener("change", () => {
    try {
      localStorage.setItem(key, input.value);
    } catch {}
    applyVisualSettings();
  });
}

function applyVisualSettings() {
  document.body.dataset.clockSize = clockSizeInput.value;
  document.body.dataset.timeTheme = timeThemeInput.value;
  window.dispatchEvent(new CustomEvent("pausefisk:settings", {
    detail: { theme: timeThemeInput.value },
  }));
}

rememberSelect(clockSizeInput, "pausefisk.clockSize", "medium");
rememberSelect(timeThemeInput, "pausefisk.timeTheme", "noon");
applyVisualSettings();

// "Fiskene dør"-valget huskes i browseren; &doede i adressen slår det til
const DEAD_FISH_KEY = "pausefisk.deadFish";
try {
  deadFishInput.checked = localStorage.getItem(DEAD_FISH_KEY) === "true";
} catch {}
if (new URLSearchParams(location.search).has("doede")) deadFishInput.checked = true;
deadFishInput.addEventListener("change", () => {
  try {
    localStorage.setItem(DEAD_FISH_KEY, String(deadFishInput.checked));
  } catch {}
});

// Beskeden under uret huskes til næste gang; &besked=... i adressen sætter den
const MESSAGE_KEY = "pausefisk.message";
try {
  messageInput.value = localStorage.getItem(MESSAGE_KEY) ?? "";
} catch {}
const messageFromUrl = new URLSearchParams(location.search).get("besked");
if (messageFromUrl !== null) messageInput.value = messageFromUrl;
messageInput.addEventListener("input", () => {
  try {
    localStorage.setItem(MESSAGE_KEY, messageInput.value);
  } catch {}
});

// Urets farve vælges med farve-knapper og huskes; &farve=turkis i adressen sætter den
const CLOCK_COLOR_KEY = "pausefisk.clockColor";
let clockColor = "hvid";
try {
  clockColor = localStorage.getItem(CLOCK_COLOR_KEY) ?? clockColor;
} catch {}
clockColor = new URLSearchParams(location.search).get("farve") ?? clockColor;
if (!CLOCK_COLORS[clockColor]) clockColor = "hvid";
for (const [value, [name, rgb]] of Object.entries(CLOCK_COLORS)) {
  const label = document.createElement("label");
  label.className = "swatch";
  label.title = name;
  label.innerHTML = `<input type="radio" name="clock-color" value="${value}" aria-label="${name}" /><span style="--swatch: rgb(${rgb})"></span>`;
  const input = label.querySelector("input");
  input.checked = value === clockColor;
  input.addEventListener("change", () => {
    clockColor = value;
    try {
      localStorage.setItem(CLOCK_COLOR_KEY, value);
    } catch {}
  });
  document.getElementById("clock-color").append(label);
}

// "Lille ur i hjørnet" huskes også; &hjoerne i adressen slår det til
rememberToggle(cornerInput, "pausefisk.corner", "hjoerne");

function rememberToggle(input, key, urlParam) {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) input.checked = saved === "true";
  } catch {}
  if (new URLSearchParams(location.search).has(urlParam)) input.checked = true;
  input.addEventListener("change", () => {
    try {
      localStorage.setItem(key, String(input.checked));
    } catch {}
  });
}

// Hold skærmen tændt mens nedtællingen eller akvariet kører, så den ikke går i dvale midt i pausen
let wakeLock = null;
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // Fx hvis browseren ikke tillader det lige nu – så prøver vi igen, når fanen bliver synlig
  }
}
// Browseren slipper låsen, når fanen skjules; tag den igen, når den er synlig
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (state || aquariumOnly)) keepScreenOn(true);
});

// "Vis kun akvariet": akvariet kører uden ur, fx før kurset eller i frokostpausen
document.getElementById("aquarium-only").addEventListener("click", showAquariumOnly);

// Klokken er slået til som standard; valget huskes også
const SOUND_KEY = "pausefisk.sound";
try {
  const saved = localStorage.getItem(SOUND_KEY);
  if (saved !== null) soundInput.checked = saved === "true";
} catch {}
soundInput.addEventListener("change", () => setSound(soundInput.checked));
sound.setEnabled(soundInput.checked);

function setSound(on) {
  soundInput.checked = on;
  sound.setEnabled(on);
  try {
    localStorage.setItem(SOUND_KEY, String(on));
  } catch {}
}

// endTime når uret kører, remaining når det er sat på pause
let state = null; // { endTime, remaining, total, paused }
let lastText = "";
let lastSeconds = null;
let phase = "idle"; // "idle" | "running" | "final" (sidste minut) | "digits" (sidste 10 sek.) | "overtime"
const FINAL_MS = 60_000;

setup.addEventListener("submit", (e) => {
  e.preventDefault();
  const minutes = Number(minutesInput.value);
  if (minutes > 0) start(minutes);
});

for (const button of setup.querySelectorAll("[data-min]")) {
  button.addEventListener("click", () => start(Number(button.dataset.min)));
}

document.addEventListener("keydown", (e) => {
  if (aquariumOnly) {
    if (e.key === "r" || e.key === "R" || e.key === "Escape") {
      e.preventDefault();
      leaveAquariumOnly();
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    }
    return;
  }
  if (!state) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePause();
  } else if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") {
    addTime(60_000);
  } else if (["1", "2", "5"].includes(e.key)) {
    addTime(Number(e.key) * 60_000);
  } else if (e.key === "-" || e.code === "NumpadSubtract") {
    addTime(-60_000);
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault(); // ellers lander "r" i minut-feltet
    reset();
  } else if (e.key === "f" || e.key === "F") {
    toggleFullscreen();
  } else if (e.key === "m" || e.key === "M") {
    setSound(!soundInput.checked);
  }
});

// Knapperne i bjælken lægger ekstra minutter til
for (const button of help.querySelectorAll("[data-add]")) {
  button.addEventListener("click", () => {
    addTime(Number(button.dataset.add) * 60_000);
    button.blur(); // så mellemrum ikke "klikker" knappen igen
  });
}

// ?min=10 starter nedtællingen med det samme
const fromUrl = Number(new URLSearchParams(location.search).get("min"));
if (fromUrl > 0) start(fromUrl);
else if (new URLSearchParams(location.search).has("akvarie")) showAquariumOnly();
else minutesInput.select();

setupIdleHiding();

function start(minutes) {
  // Akvariet (main.js) læser valget, når tiden er gået
  document.body.dataset.deadFish = String(deadFishInput.checked);
  applyVisualSettings();
  const total = Math.round(minutes * 60_000);
  state = { endTime: Date.now() + total, remaining: total, total, paused: false };
  minutesInput.value = minutes;
  const message = messageInput.value.trim();
  messageText.textContent = message;
  messageText.hidden = !message;
  lastText = "";
  lastSeconds = null;
  keepScreenOn(true);
  setup.hidden = true;
  clock.hidden = false;
  help.hidden = false;
  document.body.classList.add("running");
  window.dispatchEvent(new CustomEvent("pausefisk:session")); // akvariet begynder at få flere fisk
  render();
  requestAnimationFrame(tick);
}

function reset() {
  state = null;
  keepScreenOn(false);
  clock.hidden = true;
  help.hidden = true;
  setup.hidden = false;
  document.body.classList.remove("running");
  document.title = "Pausefisk";
  setPhase("idle");
  minutesInput.focus();
  minutesInput.select();
}

function showAquariumOnly() {
  aquariumOnly = true;
  keepScreenOn(true);
  setup.hidden = true;
  aquariumHelp.hidden = false;
  document.body.classList.add("aquarium-only");
  window.dispatchEvent(new CustomEvent("pausefisk:session"));
  document.activeElement?.blur();
}

function leaveAquariumOnly() {
  aquariumOnly = false;
  keepScreenOn(false);
  aquariumHelp.hidden = true;
  setup.hidden = false;
  document.body.classList.remove("aquarium-only");
  minutesInput.focus();
  minutesInput.select();
}

function togglePause() {
  if (state.paused) {
    state.endTime = Date.now() + state.remaining;
    state.paused = false;
  } else {
    state.remaining = state.endTime - Date.now();
    state.paused = true;
  }
  render();
}

function addTime(ms) {
  state.total = Math.max(60_000, state.total + ms);
  if (state.paused) state.remaining += ms;
  else state.endTime += ms;
  if (ms > 0) {
    window.dispatchEvent(new CustomEvent("pausefisk:time-added", { detail: { minutes: ms / 60_000 } }));
  }
  render();
}

// Akvariet (main.js) lytter på faseskift. Fasen gemmes også på <body>, så akvariet kan læse den,
// hvis nedtællingen blev startet før fiskene var indlæst.
function setPhase(next) {
  if (next === phase) return;
  const previous = phase;
  phase = next;
  if (phase === "overtime") sound.bell();
  // Forvarsel: et enkelt diskret ding når der er ét minut tilbage (ikke hvis pausen starter under et minut)
  if (phase === "final" && previous === "running") sound.ding();
  document.body.dataset.phase = phase;
  window.dispatchEvent(new CustomEvent("pausefisk:phase", { detail: { phase } }));
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function tick() {
  if (!state) return;
  render();
  requestAnimationFrame(tick);
}

function render() {
  const remaining = state.paused ? state.remaining : state.endTime - Date.now();
  const overtime = remaining <= -1000;
  setPhase(overtime ? "overtime" : remaining <= DIGITS_MS ? "digits" : remaining <= FINAL_MS ? "final" : "running");

  // Rund op mens der er tid tilbage, så 00:00:00 vises præcis når tiden er gået
  const seconds = remaining > 0 ? Math.ceil(remaining / 1000) : Math.floor(-remaining / 1000);

  // Fortæl akvariet hvilket tal stimen skal danne
  if (phase === "digits" && seconds !== lastSeconds) {
    lastSeconds = seconds;
    window.dispatchEvent(new CustomEvent("pausefisk:seconds", { detail: { seconds } }));
  }
  const text = (overtime ? "−" : "") + formatMS(seconds);

  if (text !== lastText) {
    timeEl.textContent = text;
    lastText = text;
  }

  clock.classList.toggle("corner", cornerInput.checked && remaining > CORNER_UNTIL_MS);
  clock.classList.toggle("overtime", overtime);
  clock.classList.toggle("paused", state.paused);
  timeEl.style.setProperty("--clock-color", overtime ? RED : fadeColor(remaining));
  subtitleEl.textContent = subtitle(remaining, overtime);
  document.title = `${text} · Pausefisk`;
}

function fadeColor(remaining) {
  const window = Math.min(FADE_WINDOW_MS, state.total);
  const t = Math.min(1, Math.max(0, remaining / window)); // 1 = valgt farve, 0 = orange
  const eased = t * t * (3 - 2 * t);
  const base = CLOCK_COLORS[clockColor][1];
  const c = ORANGE.map((o, i) => Math.round(o + (base[i] - o) * eased));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function subtitle(remaining, overtime) {
  if (state.paused) return "Sat på pause";
  if (overtime) return "Pausen er slut";
  const end = new Date(Date.now() + Math.max(0, remaining));
  const hh = String(end.getHours()).padStart(2, "0");
  const mm = String(end.getMinutes()).padStart(2, "0");
  return `Vi fortsætter kl. ${hh}:${mm}`;
}

// Minutter kan godt gå over 59, fx 90:00 for en lang pause
function formatMS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function setupIdleHiding() {
  let timer;
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add("idle"), IDLE_MS);
  };
  for (const ev of ["mousemove", "mousedown", "keydown", "touchstart"]) {
    window.addEventListener(ev, wake, { passive: true });
  }
  wake();
}

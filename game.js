// Bible Guesser - game logic

const GAME_VERSION = 'v18';   // shown at bottom of screen so you can confirm what's loaded

const ROUNDS = 5;
const ROUND_SECONDS = 30;

const SUPA_URL = 'https://fineilshrveswglykogx.supabase.co';
const SUPA_KEY = 'sb_publishable_6B6BmSvCDNNtRsg8DzSzrw_gD-U6oV7';

let verses = [];
let FACTS = {};         // ref -> fun fact / historical note
let deck = [];
let roundIndex = 0;
let totalScore = 0;
let roundScores = [];   // {place, points, guess, answer} per round, for the recap
let summaryLayers = []; // all map layers drawn on the end-of-game recap
let summaryGuessLayers = []; // just the guess pins + lines (hidden in map-focus)
let resultsActive = false;   // true while the final results screen is showing
let current = null;
let guessMarker = null;
let answerMarker = null;
let line = null;
let locked = false;
let playerName = '';

let timeLeft = ROUND_SECONDS;
let timerId = null;

const BETWEEN_SECONDS = 5;   // pause between screens before auto-advancing
let autoId = null;

// ---- Map ----
const map = L.map('map', { worldCopyJump: true }).setView([31.5, 35.5], 5);

// Guessing layer: physical relief with NO place labels (no cheating)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: US National Park Service',
  maxZoom: 8
}).addTo(map);

// Border lines (NO place names) shown on the GUESSING map to help you orient.
// Drawn from a local GeoJSON so it's reliable and offline-friendly.
let bordersLayer = null;
fetch('countries.geo.json')
  .then(r => r.json())
  .then(geo => {
    bordersLayer = L.geoJSON(geo, {
      interactive: false,
      style: { color: '#5e4622', weight: 1, opacity: 0.65, fill: false }
    }).addTo(map);   // always on during play
  })
  .catch(() => { /* borders are a nice-to-have; ignore if it fails */ });

// Reveal layer: National Geographic atlas WITH places and names. Added only
// when the true location is shown, removed again each round.
const bibleLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; National Geographic, DeLorme, HERE, UNEP-WCMC',
  maxZoom: 16
});

// Coloured map pins: red = your guess, green = the correct answer
function makePin(color) {
  return L.divIcon({
    className: 'pin-icon',
    html: `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.6 13 25 13 25s13-15.4 13-25C26 5.82 20.18 0 13 0z" fill="${color}" stroke="#3b2f1e" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="4.5" fill="#fbf8f1"/>
    </svg>`,
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    tooltipAnchor: [0, -34],
    popupAnchor: [0, -34]
  });
}
const answerPin = makePin('#2e8b57');   // green = correct
const guessPin  = makePin('#d6453d');   // red = your guess

// ---- DOM ----
const verseText    = document.getElementById('verse-text');
const verseRef     = document.getElementById('verse-ref');
const confirmBtn   = document.getElementById('confirm-fab');
const nextBtn      = document.getElementById('next-fab');
const nextBadge    = nextBtn.querySelector('.fab-badge');
const versePanel   = document.getElementById('verse-panel');
const resultBox    = document.getElementById('result');
const roundLabel   = document.getElementById('round-label');
const scoreLabel   = document.getElementById('score-label');
const timerLabel   = document.getElementById('timer-label');
const clockFg      = document.querySelector('.clock-fg');
const clockNum     = document.querySelector('.clock-num');
const startOverlay = document.getElementById('start-overlay');
const goBtn        = document.getElementById('go-btn');
const nameInput    = document.getElementById('player-name');
const leaderboard  = document.getElementById('leaderboard');
const lbModal      = document.getElementById('lb-modal');
const lbModalBody  = document.getElementById('lb-modal-body');
const lbFab        = document.getElementById('lb-fab');
const resizeFab    = document.getElementById('resize-fab');
const lbCloseBtn   = document.getElementById('lb-close');
const lbOpenStart  = document.getElementById('lb-open-start');
const musicBtn     = document.getElementById('music-btn');
const versionEl    = document.getElementById('version');
if (versionEl) versionEl.textContent = GAME_VERSION;

const CLOCK_CIRC = 2 * Math.PI * 16;   // circumference of the clock ring (r = 16)

// Smoothly animate a numeric label from one value to another (count-up effect)
function animateCount(el, from, to, prefix = '', ms = 650) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);   // easeOutCubic
    el.textContent = `${prefix}${Math.round(from + (to - from) * eased)}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Sound ----
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq = 440, duration = 0.12, type = 'square', vol = 0.18) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { /* ignore */ }
}
function timeoutBuzz() {
  beep(200, 0.25, 'sawtooth', 0.25);
  setTimeout(() => beep(140, 0.4, 'sawtooth', 0.25), 180);
}

// Play a sequence of notes: [freq, durationSec] pairs, spaced by `gap` ms
function playMelody(notes, gap = 130, type = 'triangle', vol = 0.2) {
  notes.forEach(([f, d], i) => setTimeout(() => beep(f, d, type, vol), i * gap));
}

// Soft click when a guess is confirmed
function sfxConfirm() { beep(520, 0.07, 'triangle', 0.16); }

// Result chime that scales with how good the guess was
function sfxReveal(points) {
  if (points >= 3500)      playMelody([[659, 0.12], [880, 0.12], [1175, 0.2]]);   // great
  else if (points >= 1800) playMelody([[622, 0.12], [831, 0.16]]);                // good
  else if (points >= 600)  beep(494, 0.18, 'sine', 0.18);                         // okay
  else                     timeoutBuzz();                                          // miss
}

// Victory fanfare for a new personal best
function sfxFanfare() {
  playMelody([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.26]], 140, 'triangle', 0.22);
}

// Gentle two-note flourish at game over
function sfxGameOver() { playMelody([[523, 0.16], [659, 0.16], [784, 0.24]], 150, 'sine', 0.2); }

// ---- Background music (upbeat generative loop) ----
const MUSIC_KEY = 'bibleGuesser_music';
let musicOn = localStorage.getItem(MUSIC_KEY) !== '0';   // default on
let musicTimer = null;
let musicBus = null;
let musicStep = 0;

const STEP_MS = 200;          // sixteenth-ish; lively tempo
const STEPS_PER_CHORD = 8;
// Progression C - G - Am - Em - F - C - F - G, each chord with a bass note,
// a soft pad, a 4-note rolling arpeggio, and a singing top melody (mel/mel2).
const SONG = [
  { bass: 130.81, pad: [261.63, 329.63, 392.00], arp: [261.63, 329.63, 392.00, 523.25], mel: 523.25, mel2: 659.25 }, // C
  { bass: 196.00, pad: [246.94, 293.66, 392.00], arp: [293.66, 392.00, 493.88, 587.33], mel: 493.88, mel2: 587.33 }, // G
  { bass: 220.00, pad: [261.63, 329.63, 440.00], arp: [329.63, 440.00, 523.25, 659.25], mel: 523.25, mel2: 659.25 }, // Am
  { bass: 164.81, pad: [246.94, 329.63, 392.00], arp: [329.63, 392.00, 493.88, 659.25], mel: 493.88, mel2: 587.33 }, // Em
  { bass: 174.61, pad: [261.63, 349.23, 440.00], arp: [349.23, 440.00, 523.25, 698.46], mel: 523.25, mel2: 698.46 }, // F
  { bass: 130.81, pad: [261.63, 329.63, 392.00], arp: [392.00, 523.25, 659.25, 783.99], mel: 659.25, mel2: 783.99 }, // C (high)
  { bass: 174.61, pad: [261.63, 349.23, 440.00], arp: [349.23, 440.00, 523.25, 698.46], mel: 587.33, mel2: 523.25 }, // F
  { bass: 196.00, pad: [246.94, 293.66, 392.00], arp: [293.66, 392.00, 493.88, 587.33], mel: 587.33, mel2: 493.88 }  // G (turnaround)
];
// flowing up-and-down arpeggio over the 4 chord tones
const ARP_PATTERN = [0, 1, 2, 3, 2, 3, 1, 2];

function tone(freq, dur, type, vol, attack = 0.02) {
  if (!audioCtx || !musicBus) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(musicBus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function musicTick() {
  if (!audioCtx || !musicBus) return;
  const chord = SONG[Math.floor(musicStep / STEPS_PER_CHORD) % SONG.length];
  const stepInChord = musicStep % STEPS_PER_CHORD;

  if (stepInChord === 0) {
    tone(chord.bass, 0.7, 'triangle', 0.5);                   // bass on the beat
    chord.pad.forEach(f => tone(f, 2.0, 'sine', 0.1, 0.4));   // soft, slow pad swell
    if (chord.mel) tone(chord.mel, 1.7, 'triangle', 0.16, 0.12);  // singing melody
  }
  if (stepInChord === 4 && chord.mel2) {
    tone(chord.mel2, 1.2, 'triangle', 0.14, 0.1);             // melody moves mid-bar
  }
  // gentle plucked arpeggio on every step
  tone(chord.arp[ARP_PATTERN[stepInChord]], 0.18, 'triangle', 0.28);

  musicStep = (musicStep + 1) % (STEPS_PER_CHORD * SONG.length);
}

function startMusic() {
  if (!audioCtx || musicTimer) return;
  musicBus = audioCtx.createGain();
  musicBus.gain.value = 0.085;                 // sits under the sfx
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;                   // bright enough for plucks
  musicBus.connect(lp);
  lp.connect(audioCtx.destination);
  musicStep = 0;
  musicTick();
  musicTimer = setInterval(musicTick, STEP_MS);
}

function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (musicBus) { try { musicBus.disconnect(); } catch (e) {} musicBus = null; }
}

function setMusic(on) {
  musicOn = on;
  localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  if (musicBtn) musicBtn.textContent = on ? '♫' : '🔇';  // ♫ / 🔇
  if (on) { initAudio(); startMusic(); } else { stopMusic(); }
}

// ---- Helpers ----
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreFor(distanceKm) {
  // Even stricter falloff: precision really matters now
  return Math.round(5000 * Math.exp(-distanceKm / 320));
}

// ---- Personal best ----
const PB_KEY = 'bibleGuesser_personalBest';
function getPersonalBest() { return parseInt(localStorage.getItem(PB_KEY) || '0', 10); }
function savePersonalBest(score) {
  if (score > getPersonalBest()) localStorage.setItem(PB_KEY, score);
}

// ---- Supabase ----
const supaHeaders = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json'
};

async function submitScore(name, score) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({ name, score })
    });
  } catch (e) { console.warn('Score submit failed:', e); }
}

async function fetchLeaderboard() {
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/scores?select=name,score&order=score.desc&limit=10`,
      { headers: supaHeaders }
    );
    return await res.json();
  } catch (e) { return null; }
}

// Build the leaderboard table HTML. `highlightScore` (optional) highlights the
// player's just-played row.
function leaderboardTableHTML(rows, highlightScore) {
  if (!rows || rows.length === 0) {
    return '<p class="lb-empty">No scores yet — be the first!</p>';
  }
  const rowsHtml = rows.map((r, i) => {
    const mine = highlightScore != null && r.score === highlightScore && r.name === playerName;
    return `<tr class="${mine ? 'lb-me' : ''}">
      <td>${i + 1}</td>
      <td>${escHtml(r.name)}</td>
      <td>${r.score}</td>
    </tr>`;
  }).join('');
  return `<table class="lb-table">
      <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

function renderLeaderboard(rows, myScore) {
  leaderboard.innerHTML = '<h3>Top 10</h3>' + leaderboardTableHTML(rows, myScore);
  leaderboard.classList.remove('hidden');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- Leaderboard modal (viewable any time) ----
async function openLeaderboardModal() {
  lbModal.classList.remove('hidden');
  lbModalBody.innerHTML = '<p class="lb-loading">Loading...</p>';
  const rows = await fetchLeaderboard();
  lbModalBody.innerHTML = leaderboardTableHTML(rows, null);
}
function closeLeaderboardModal() { lbModal.classList.add('hidden'); }

// ---- Timer / clock ----
function updateClock() {
  const frac = Math.max(0, timeLeft / ROUND_SECONDS);
  if (clockFg) clockFg.style.strokeDashoffset = CLOCK_CIRC * (1 - frac);
  if (clockNum) clockNum.textContent = timeLeft;
  timerLabel.classList.toggle('low', timeLeft <= 10);
}

function startTimer() {
  clearInterval(timerId);
  timeLeft = ROUND_SECONDS;
  // reset the ring to full instantly (no reverse-sweep animation)
  if (clockFg) {
    clockFg.style.transition = 'none';
    updateClock();
    void clockFg.getBoundingClientRect();   // force reflow
    clockFg.style.transition = '';
  } else {
    updateClock();
  }
  timerId = setInterval(() => {
    timeLeft--;
    updateClock();
    if (timeLeft <= 5 && timeLeft > 0) beep(700, 0.09, 'square', 0.15);
    if (timeLeft <= 0) { clearInterval(timerId); timeUp(); }
  }, 1000);
}

function stopTimer() { clearInterval(timerId); timerId = null; }

// ---- Game flow ----
function startRound() {
  locked = false;
  clearAuto();
  current = deck[roundIndex];

  verseText.textContent = '"' + current.text + '"';
  verseRef.textContent = current.ref;
  resultBox.innerHTML = '';
  leaderboard.classList.add('hidden');
  confirmBtn.disabled = true;
  confirmBtn.classList.add('hidden');         // shows once a guess is placed
  if (lbFab) lbFab.classList.add('hidden');   // hide leaderboard during play
  nextBtn.classList.add('hidden');
  nextBtn.classList.remove('restart');

  // leave the results layout
  resultsActive = false;
  if (resizeFab) resizeFab.classList.add('hidden');
  document.body.classList.remove('results', 'layout-half', 'layout-results', 'layout-map');

  roundLabel.textContent = `Round ${roundIndex + 1} / ${ROUNDS}`;
  scoreLabel.textContent = `Score: ${totalScore}`;

  [guessMarker, answerMarker, line].forEach(l => { if (l) map.removeLayer(l); });
  guessMarker = answerMarker = line = null;
  clearSummary();

  // back to the borders-only guessing map (drop the named reveal layer)
  if (map.hasLayer(bibleLayer)) map.removeLayer(bibleLayer);
  if (bordersLayer && !map.hasLayer(bordersLayer)) bordersLayer.addTo(map);

  map.setView([31.5, 35.5], 5);
  // the panel/map split may have just changed (e.g. coming back from results);
  // let the layout settle then tell Leaflet to recompute its size
  setTimeout(() => map.invalidateSize(), 60);
  startTimer();
}

map.on('click', e => {
  if (locked) return;
  if (guessMarker) map.removeLayer(guessMarker);
  guessMarker = L.marker(e.latlng, { icon: guessPin }).addTo(map);
  confirmBtn.disabled = false;
  confirmBtn.classList.remove('hidden');
});

function finishRound(g) {
  if (locked) return;
  locked = true;
  stopTimer();
  confirmBtn.disabled = true;

  let points = 0;
  // reveal the labeled atlas map (places and names); hide the plain borders
  bibleLayer.addTo(map);
  if (bordersLayer && map.hasLayer(bordersLayer)) map.removeLayer(bordersLayer);
  const fact = FACTS[current.ref] || '';
  const popupFact = fact ? `<br><span class="popup-fact">${fact}</span>` : '';
  answerMarker = L.marker([current.lat, current.lon], { title: current.place, icon: answerPin })
    .addTo(map)
    // permanent label so the place name floats right on the map pin
    .bindTooltip(current.place, {
      permanent: true, direction: 'top', offset: [0, -8], className: 'place-tooltip'
    })
    .bindPopup(`<b>${current.place}</b><br>${current.event}<br><i>${current.era}</i>${popupFact}`);
  answerMarker.openTooltip();

  const eraLine = `<p class="era">When: <strong>${current.era}</strong></p>`;
  const factLine = fact ? `<p class="fact">&#128220; ${fact}</p>` : '';

  if (g) {
    const distance = haversine(g.lat, g.lng, current.lat, current.lon);
    points = scoreFor(distance);
    line = L.polyline([[g.lat, g.lng], [current.lat, current.lon]], {
      color: '#8a5a2b', dashArray: '6 6'
    }).addTo(map);
    map.fitBounds(line.getBounds().pad(0.4));
    resultBox.innerHTML =
      `<p><span class="place">${current.place}</span> &mdash; ${current.event}</p>` +
      eraLine +
      `<p>You were <span class="dist">${distance.toFixed(0)} km</span> away.</p>` +
      `<p>+<span class="points" id="round-points">0</span> points</p>` +
      factLine;
  } else {
    map.setView([current.lat, current.lon], 6);
    resultBox.innerHTML =
      `<p><strong>Time's up!</strong> No guess placed.</p>` +
      `<p><span class="place">${current.place}</span> &mdash; ${current.event}</p>` +
      eraLine +
      `<p>+<span class="points" id="round-points">0</span> points</p>` +
      factLine;
  }

  sfxReveal(points);

  roundScores.push({
    place: current.place,
    points,
    guess: g ? { lat: g.lat, lon: g.lng } : null,
    answer: { lat: current.lat, lon: current.lon }
  });

  const prevTotal = totalScore;
  totalScore += points;
  // count the header total up, and the round points up from zero
  animateCount(scoreLabel, prevTotal, totalScore, 'Score: ');
  const rp = document.getElementById('round-points');
  if (rp) animateCount(rp, 0, points, '', 700);

  confirmBtn.classList.add('hidden');

  startAutoAdvance();
}

// Auto-advance to the next screen after a short pause, with a countdown badge
// on the Next button. The player can also tap the button to skip the wait.
function startAutoAdvance() {
  clearAuto();
  nextBtn.classList.remove('restart', 'hidden');
  let remaining = BETWEEN_SECONDS;
  nextBadge.textContent = remaining;
  autoId = setInterval(() => {
    remaining--;
    if (remaining <= 0) advance();
    else nextBadge.textContent = remaining;
  }, 1000);
}

function clearAuto() {
  if (autoId) { clearInterval(autoId); autoId = null; }
}

function advance() {
  clearAuto();
  roundIndex++;
  if (roundIndex < ROUNDS) startRound(); else endGame();
}

function timeUp() {
  if (locked) return;
  finishRound(guessMarker ? guessMarker.getLatLng() : null);
}

confirmBtn.addEventListener('click', () => {
  if (!guessMarker || locked) return;
  sfxConfirm();
  finishRound(guessMarker.getLatLng());
});

nextBtn.onclick = () => {
  if (nextBtn.classList.contains('restart')) {
    newGame();
    return;
  }
  advance();   // skip the countdown
};

function clearSummary() {
  summaryLayers.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  summaryLayers = [];
  summaryGuessLayers = [];
}

// Draw every round's guess (dot) and answer (pin + place name) on one map
function renderSummary() {
  // drop the last round's single markers/line first
  [guessMarker, answerMarker, line].forEach(l => { if (l) map.removeLayer(l); });
  guessMarker = answerMarker = line = null;
  clearSummary();

  const pts = [];
  roundScores.forEach((r, i) => {
    if (!r.answer) return;
    const a = [r.answer.lat, r.answer.lon];
    const am = L.marker(a, { title: r.place, icon: answerPin })
      .addTo(map)
      .bindTooltip(`${i + 1}. ${r.place}`, {
        permanent: true, direction: 'top', offset: [0, -34], className: 'place-tooltip'
      })
      .openTooltip();
    summaryLayers.push(am);
    pts.push(a);

    if (r.guess) {
      const g = [r.guess.lat, r.guess.lon];
      const gm = L.marker(g, { icon: guessPin })
        .addTo(map)
        .bindTooltip(`Your guess ${i + 1}`, { direction: 'bottom' });
      const ln = L.polyline([g, a], { color: '#8a5a2b', dashArray: '5 5', weight: 2 }).addTo(map);
      summaryLayers.push(gm, ln);
      summaryGuessLayers.push(gm, ln);
      pts.push(g);
    }
  });

  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
}

// Results screen: resize between panel-focus, map-focus, or half/half.
// Both the red (guess) and green (answer) pins stay visible in every mode.
function setLayout(mode) {
  document.body.classList.remove('layout-half', 'layout-results', 'layout-map');
  document.body.classList.add('layout-' + mode);
  // let the CSS height transition finish, then refit the map tiles
  setTimeout(() => map.invalidateSize(), 280);
}

// Resize button cycles the split: half -> results-big -> map-big -> half
const LAYOUT_CYCLE = ['half', 'results', 'map'];
if (resizeFab) resizeFab.addEventListener('click', () => {
  if (!resultsActive) return;
  const cur = LAYOUT_CYCLE.findIndex(m => document.body.classList.contains('layout-' + m));
  const next = LAYOUT_CYCLE[(cur + 1) % LAYOUT_CYCLE.length];
  setLayout(next);
});

async function endGame() {
  stopTimer();
  clearAuto();
  confirmBtn.classList.add('hidden');
  if (lbFab) lbFab.classList.remove('hidden');   // leaderboard available again
  // reset the clock to empty
  if (clockNum) clockNum.textContent = '0';
  if (clockFg) clockFg.style.strokeDashoffset = CLOCK_CIRC;
  timerLabel.classList.remove('low');
  verseText.textContent = 'Game over!';
  verseRef.textContent = '';

  const prevBest = getPersonalBest();
  savePersonalBest(totalScore);

  const breakdown = roundScores.map((r, i) =>
    `<tr><td>${i + 1}</td><td>${escHtml(r.place)}</td><td>${r.points}</td></tr>`
  ).join('');

  resultBox.innerHTML =
    `<h3 class="rounds-title">Your rounds</h3>` +
    `<table class="rounds-table"><tbody>${breakdown}</tbody></table>` +
    `<p class="final-line">Total: <span class="points" id="final-score">0</span> / ${ROUNDS * 5000}</p>` +
    (prevBest > 0 ? `<p class="pb-line">Best: ${Math.max(prevBest, totalScore)}</p>` : '') +
    `<p class="map-note">Map pins: <span class="guess-c">red = your guess</span>, <span class="answer-c">green = answer</span>.</p>`;

  // draw every guess + answer on the map
  renderSummary();

  // enable the results layout (starts half/half); resize button cycles it
  resultsActive = true;
  document.body.classList.add('results');
  if (resizeFab) resizeFab.classList.remove('hidden');
  setLayout('half');

  const fs = document.getElementById('final-score');
  if (fs) animateCount(fs, 0, totalScore, '', 1000);

  // gentle closing flourish after the count-up settles
  setTimeout(() => sfxGameOver(), 1050);

  // Next button becomes a "play again" restart icon
  nextBtn.classList.add('restart');
  nextBtn.classList.remove('hidden');

  // submit then show leaderboard
  leaderboard.innerHTML = '<p class="lb-loading">Saving score...</p>';
  leaderboard.classList.remove('hidden');
  await submitScore(playerName, totalScore);
  const rows = await fetchLeaderboard();
  renderLeaderboard(rows, totalScore);
}

function newGame() {
  roundIndex = 0;
  totalScore = 0;
  roundScores = [];
  deck = shuffle(verses).slice(0, ROUNDS);
  startRound();
}

// ---- Leaderboard modal wiring ----
if (lbFab)       lbFab.addEventListener('click', openLeaderboardModal);
if (lbOpenStart) lbOpenStart.addEventListener('click', openLeaderboardModal);
if (lbCloseBtn)  lbCloseBtn.addEventListener('click', closeLeaderboardModal);
if (lbModal)     lbModal.addEventListener('click', e => {
  if (e.target === lbModal) closeLeaderboardModal();   // click backdrop to close
});

// ---- Music toggle ----
if (musicBtn) {
  musicBtn.textContent = musicOn ? '♫' : '🔇';  // ♫ / 🔇
  musicBtn.addEventListener('click', () => setMusic(!musicOn));
}

// ---- Start screen ----
const NAME_KEY = 'bibleGuesser_playerName';
nameInput.value = localStorage.getItem(NAME_KEY) || '';

function canGo() {
  return nameInput.value.trim().length >= 2 && !goBtn.disabled;
}

nameInput.addEventListener('input', () => {
  goBtn.disabled = nameInput.value.trim().length < 2;
});

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && canGo()) goBtn.click();
});

goBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (name.length < 2) return;
  playerName = name;
  localStorage.setItem(NAME_KEY, name);
  initAudio();
  if (musicOn) startMusic();   // start the chilled background loop
  startOverlay.style.display = 'none';
  newGame();
  // map container size may have settled now the overlay is gone
  setTimeout(() => map.invalidateSize(), 120);
});

// Keep the map correctly sized when the phone rotates or the window resizes
window.addEventListener('resize', () => map.invalidateSize());
window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 200));

// ---- Load verses ----
fetch('verses.json')
  .then(r => r.json())
  .then(data => {
    verses = data;
    if (verses.length < ROUNDS) {
      goBtn.textContent = `Need ${ROUNDS}+ verses`;
      return;
    }
    // enable Go only if a valid name is already filled in
    goBtn.disabled = nameInput.value.trim().length < 2;
    if (goBtn.disabled) goBtn.textContent = 'Enter your name above';
    else goBtn.textContent = 'Go';

    // watch name changes now that verses are loaded
    nameInput.addEventListener('input', () => {
      const ok = nameInput.value.trim().length >= 2;
      goBtn.disabled = !ok;
      goBtn.textContent = ok ? 'Go' : 'Enter your name above';
    });
  })
  .catch(() => {
    goBtn.textContent = 'Failed to load verses';
  });

// ---- Load fun facts (optional; shown on reveal) ----
fetch('facts.json')
  .then(r => r.json())
  .then(data => { FACTS = data || {}; })
  .catch(() => { FACTS = {}; });

// Bible Guesser - game logic

const ROUNDS = 5;
const ROUND_SECONDS = 30;   // time limit per round

let verses = [];
let deck = [];          // shuffled subset for this game
let roundIndex = 0;
let totalScore = 0;
let current = null;     // current verse
let guessMarker = null;
let answerMarker = null;
let line = null;
let locked = false;     // true once a guess is confirmed / time is up

let timeLeft = ROUND_SECONDS;
let timerId = null;

// ---- Map setup ----
const map = L.map('map', { worldCopyJump: true }).setView([31.5, 35.5], 5);
// Esri World Physical Map: an earth-toned, vintage-atlas look with NO city
// labels - so players can't cheat by reading place names off the map.
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: US National Park Service',
  maxZoom: 8
}).addTo(map);

// ---- DOM ----
const verseText  = document.getElementById('verse-text');
const verseRef   = document.getElementById('verse-ref');
const confirmBtn = document.getElementById('confirm-btn');
const nextBtn    = document.getElementById('next-btn');
const resultBox  = document.getElementById('result');
const roundLabel = document.getElementById('round-label');
const scoreLabel = document.getElementById('score-label');
const timerLabel = document.getElementById('timer-label');
const startOverlay = document.getElementById('start-overlay');
const goBtn      = document.getElementById('go-btn');

// ---- Sound (Web Audio API - no sound files needed) ----
let audioCtx = null;
function initAudio() {
  // Must be created after a user gesture (the Go click) or browsers block it.
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
  // a lower, longer two-tone buzz to signal "time's up"
  beep(200, 0.25, 'sawtooth', 0.25);
  setTimeout(() => beep(140, 0.4, 'sawtooth', 0.25), 180);
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

// Haversine distance in km between two lat/lon points
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
  return Math.round(5000 * Math.exp(-distanceKm / 1000));
}

// ---- Timer ----
function updateTimerLabel() {
  timerLabel.innerHTML = `&#9201; ${timeLeft}s`;
  timerLabel.classList.toggle('low', timeLeft <= 10);
}

function startTimer() {
  clearInterval(timerId);
  timeLeft = ROUND_SECONDS;
  updateTimerLabel();
  timerId = setInterval(() => {
    timeLeft--;
    updateTimerLabel();
    if (timeLeft <= 5 && timeLeft > 0) beep(700, 0.09, 'square', 0.15);
    if (timeLeft <= 0) {
      clearInterval(timerId);
      timeUp();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

// ---- Game flow ----
function startRound() {
  locked = false;
  current = deck[roundIndex];

  verseText.textContent = '"' + current.text + '"';
  verseRef.textContent = current.ref;
  resultBox.innerHTML = '';
  confirmBtn.disabled = true;
  confirmBtn.classList.remove('hidden');
  nextBtn.classList.add('hidden');

  roundLabel.textContent = `Round ${roundIndex + 1} / ${ROUNDS}`;
  scoreLabel.textContent = `Score: ${totalScore}`;

  // clear map layers
  [guessMarker, answerMarker, line].forEach(l => { if (l) map.removeLayer(l); });
  guessMarker = answerMarker = line = null;

  map.setView([31.5, 35.5], 5);
  startTimer();
}

map.on('click', e => {
  if (locked) return;
  if (guessMarker) map.removeLayer(guessMarker);
  guessMarker = L.marker(e.latlng).addTo(map);
  confirmBtn.disabled = false;
});

// Finish the current round. `g` is the guess LatLng, or null if time ran out
// with no guess placed.
function finishRound(g) {
  if (locked) return;
  locked = true;
  stopTimer();
  confirmBtn.disabled = true;

  let points = 0;
  answerMarker = L.marker([current.lat, current.lon], { title: current.place })
    .addTo(map)
    .bindPopup(`<b>${current.place}</b><br>${current.event}`)
    .openPopup();

  if (g) {
    const distance = haversine(g.lat, g.lng, current.lat, current.lon);
    points = scoreFor(distance);
    line = L.polyline([[g.lat, g.lng], [current.lat, current.lon]], {
      color: '#8a5a2b', dashArray: '6 6'
    }).addTo(map);
    map.fitBounds(line.getBounds().pad(0.4));
    resultBox.innerHTML =
      `<p><span class="place">${current.place}</span> &mdash; ${current.event}</p>` +
      `<p>You were <span class="dist">${distance.toFixed(0)} km</span> away.</p>` +
      `<p>+<span class="points">${points}</span> points</p>`;
  } else {
    map.setView([current.lat, current.lon], 6);
    resultBox.innerHTML =
      `<p><strong>Time's up!</strong> No guess placed.</p>` +
      `<p><span class="place">${current.place}</span> &mdash; ${current.event}</p>` +
      `<p>+<span class="points">0</span> points</p>`;
  }

  totalScore += points;
  scoreLabel.textContent = `Score: ${totalScore}`;
  nextBtn.classList.remove('hidden');
  confirmBtn.classList.add('hidden');
}

function timeUp() {
  if (locked) return;
  timeoutBuzz();
  finishRound(guessMarker ? guessMarker.getLatLng() : null);
}

confirmBtn.addEventListener('click', () => {
  if (!guessMarker || locked) return;
  finishRound(guessMarker.getLatLng());
});

// Single click handler for the Next button. Behaviour depends on game state:
// during play it advances a round; after the final round it restarts.
nextBtn.onclick = () => {
  if (roundIndex >= ROUNDS - 1) {
    // we just finished the last round's result -> restart
    if (nextBtn.dataset.mode === 'restart') {
      nextBtn.textContent = 'Next round';
      delete nextBtn.dataset.mode;
      newGame();
      return;
    }
  }
  roundIndex++;
  if (roundIndex < ROUNDS) {
    startRound();
  } else {
    endGame();
  }
};

function endGame() {
  stopTimer();
  timerLabel.innerHTML = '&#9201; --';
  timerLabel.classList.remove('low');
  verseText.textContent = 'Game over!';
  verseRef.textContent = '';
  resultBox.innerHTML =
    `<p>Final score: <span class="points">${totalScore}</span> / ${ROUNDS * 5000}</p>`;
  nextBtn.textContent = 'Play again';
  nextBtn.dataset.mode = 'restart';
  nextBtn.classList.remove('hidden');
}

function newGame() {
  roundIndex = 0;
  totalScore = 0;
  deck = shuffle(verses).slice(0, ROUNDS);
  startRound();
}

// ---- Start button ----
goBtn.addEventListener('click', () => {
  initAudio();                 // unlock sound on this user gesture
  startOverlay.classList.add('hidden');
  newGame();
});

// ---- Load data ----
fetch('verses.json')
  .then(r => r.json())
  .then(data => {
    verses = data;
    if (verses.length < ROUNDS) {
      goBtn.textContent = `Need ${ROUNDS}+ verses`;
      return;
    }
    goBtn.disabled = false;
    goBtn.textContent = 'Go';
  })
  .catch(() => {
    goBtn.textContent = 'Failed to load verses';
    verseText.textContent =
      'Could not load verses.json. Run a local server (see README) and reload.';
  });

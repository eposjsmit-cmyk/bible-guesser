// Bible Guesser - game logic

const ROUNDS = 5;
const ROUND_SECONDS = 30;

const SUPA_URL = 'https://fineilshrveswglykogx.supabase.co';
const SUPA_KEY = 'sb_publishable_6B6BmSvCDNNtRsg8DzSzrw_gD-U6oV7';

let verses = [];
let deck = [];
let roundIndex = 0;
let totalScore = 0;
let current = null;
let guessMarker = null;
let answerMarker = null;
let line = null;
let locked = false;
let playerName = '';

let timeLeft = ROUND_SECONDS;
let timerId = null;

// ---- Map ----
const map = L.map('map', { worldCopyJump: true }).setView([31.5, 35.5], 5);

// Guessing layer: physical relief with NO place labels (no cheating)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: US National Park Service',
  maxZoom: 8
}).addTo(map);

// Reveal layer: National Geographic atlas style WITH borders, regions and
// place names. Added only when the true location is shown, removed each round.
const bibleLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; National Geographic, DeLorme, HERE, UNEP-WCMC',
  maxZoom: 16
});

// ---- DOM ----
const verseText    = document.getElementById('verse-text');
const verseRef     = document.getElementById('verse-ref');
const confirmBtn   = document.getElementById('confirm-btn');
const nextBtn      = document.getElementById('next-btn');
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
const lbCloseBtn   = document.getElementById('lb-close');
const lbOpenStart  = document.getElementById('lb-open-start');

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
  return Math.round(5000 * Math.exp(-distanceKm / 1000));
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
  current = deck[roundIndex];

  verseText.textContent = '"' + current.text + '"';
  verseRef.textContent = current.ref;
  resultBox.innerHTML = '';
  leaderboard.classList.add('hidden');
  confirmBtn.disabled = true;
  confirmBtn.classList.remove('hidden');
  nextBtn.classList.add('hidden');

  roundLabel.textContent = `Round ${roundIndex + 1} / ${ROUNDS}`;
  scoreLabel.textContent = `Score: ${totalScore}`;

  [guessMarker, answerMarker, line].forEach(l => { if (l) map.removeLayer(l); });
  guessMarker = answerMarker = line = null;

  // back to the no-label physical map for guessing
  if (map.hasLayer(bibleLayer)) map.removeLayer(bibleLayer);

  map.setView([31.5, 35.5], 5);
  startTimer();
}

map.on('click', e => {
  if (locked) return;
  if (guessMarker) map.removeLayer(guessMarker);
  guessMarker = L.marker(e.latlng).addTo(map);
  confirmBtn.disabled = false;
});

function finishRound(g) {
  if (locked) return;
  locked = true;
  stopTimer();
  confirmBtn.disabled = true;

  let points = 0;
  // reveal the labeled Bible-era atlas map (borders, regions, place names)
  bibleLayer.addTo(map);
  answerMarker = L.marker([current.lat, current.lon], { title: current.place })
    .addTo(map)
    .bindPopup(`<b>${current.place}</b><br>${current.event}<br><i>${current.era}</i>`)
    .openPopup();

  const eraLine = `<p class="era">When: <strong>${current.era}</strong></p>`;

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
      `<p>+<span class="points" id="round-points">0</span> points</p>`;
  } else {
    map.setView([current.lat, current.lon], 6);
    resultBox.innerHTML =
      `<p><strong>Time's up!</strong> No guess placed.</p>` +
      `<p><span class="place">${current.place}</span> &mdash; ${current.event}</p>` +
      eraLine +
      `<p>+<span class="points" id="round-points">0</span> points</p>`;
  }

  const prevTotal = totalScore;
  totalScore += points;
  // count the header total up, and the round points up from zero
  animateCount(scoreLabel, prevTotal, totalScore, 'Score: ');
  const rp = document.getElementById('round-points');
  if (rp) animateCount(rp, 0, points, '', 700);

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

nextBtn.onclick = () => {
  if (nextBtn.dataset.mode === 'restart') {
    nextBtn.textContent = 'Next round';
    delete nextBtn.dataset.mode;
    newGame();
    return;
  }
  roundIndex++;
  if (roundIndex < ROUNDS) startRound(); else endGame();
};

async function endGame() {
  stopTimer();
  // reset the clock to empty
  if (clockNum) clockNum.textContent = '0';
  if (clockFg) clockFg.style.strokeDashoffset = CLOCK_CIRC;
  timerLabel.classList.remove('low');
  verseText.textContent = 'Game over!';
  verseRef.textContent = '';

  const prevBest = getPersonalBest();
  savePersonalBest(totalScore);
  const isNewBest = totalScore > prevBest;

  resultBox.innerHTML =
    `<p>Final score: <span class="points" id="final-score">0</span> / ${ROUNDS * 5000}</p>` +
    (isNewBest
      ? `<p class="new-best">New personal best!</p>`
      : prevBest > 0 ? `<p class="pb-line">Personal best: ${prevBest}</p>` : '');

  const fs = document.getElementById('final-score');
  if (fs) animateCount(fs, 0, totalScore, '', 1000);

  nextBtn.textContent = 'Play again';
  nextBtn.dataset.mode = 'restart';
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

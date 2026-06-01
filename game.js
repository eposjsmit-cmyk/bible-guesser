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
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Source: US National Park Service',
  maxZoom: 8
}).addTo(map);

// ---- DOM ----
const verseText    = document.getElementById('verse-text');
const verseRef     = document.getElementById('verse-ref');
const confirmBtn   = document.getElementById('confirm-btn');
const nextBtn      = document.getElementById('next-btn');
const resultBox    = document.getElementById('result');
const roundLabel   = document.getElementById('round-label');
const scoreLabel   = document.getElementById('score-label');
const timerLabel   = document.getElementById('timer-label');
const startOverlay = document.getElementById('start-overlay');
const goBtn        = document.getElementById('go-btn');
const nameInput    = document.getElementById('player-name');
const leaderboard  = document.getElementById('leaderboard');

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

function renderLeaderboard(rows, myScore) {
  if (!rows || rows.length === 0) {
    leaderboard.innerHTML = '<p class="lb-empty">No scores yet — you\'re first!</p>';
    leaderboard.classList.remove('hidden');
    return;
  }
  const rowsHtml = rows.map((r, i) => {
    const mine = r.score === myScore && r.name === playerName;
    return `<tr class="${mine ? 'lb-me' : ''}">
      <td>${i + 1}</td>
      <td>${escHtml(r.name)}</td>
      <td>${r.score}</td>
    </tr>`;
  }).join('');
  leaderboard.innerHTML = `
    <h3>Top 10</h3>
    <table class="lb-table">
      <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  leaderboard.classList.remove('hidden');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  timerLabel.innerHTML = '&#9201; --';
  timerLabel.classList.remove('low');
  verseText.textContent = 'Game over!';
  verseRef.textContent = '';

  const prevBest = getPersonalBest();
  savePersonalBest(totalScore);
  const isNewBest = totalScore > prevBest;

  resultBox.innerHTML =
    `<p>Final score: <span class="points">${totalScore}</span> / ${ROUNDS * 5000}</p>` +
    (isNewBest
      ? `<p class="new-best">New personal best!</p>`
      : prevBest > 0 ? `<p class="pb-line">Personal best: ${prevBest}</p>` : '');

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
});

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

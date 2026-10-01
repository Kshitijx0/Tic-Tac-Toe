'use strict';
/* =========================================================
   TIC TAC TOE - game logic
   Sections:
   1. Constants & state     2. Saving (localStorage)
   3. Sound                 4. AI  (easy / medium / hard)
   5. Game flow             6. Screen & UI helpers
   7. Event listeners & start-up
   ========================================================= */

/* ---------- 1. CONSTANTS & STATE ---------- */

// Board cells are numbered 0-8:   0 1 2
//                                 3 4 5
//                                 6 7 8
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
  [0, 4, 8], [2, 4, 6]               // diagonals
];
const CENTER = 4;
const CORNERS = [0, 2, 6, 8];
const EDGES = [1, 3, 5, 7];
const AI_DELAY = 550;                 // ms the AI "thinks" before moving
const STORAGE_KEY = 'tictactoe-save-v1';

const DIFFICULTY_HINTS = {
  easy: 'Mostly random moves. Good for a relaxed game.',
  medium: 'Wins and blocks often, but makes mistakes.',
  hard: 'Minimax AI. It plays perfectly: the best you can do is draw.'
};

// SVG drawings for the marks (stroke animation is done in CSS)
const X_SVG = '<svg class="mark mark-x" viewBox="0 0 100 100" aria-hidden="true">' +
  '<line pathLength="1" x1="24" y1="24" x2="76" y2="76"/>' +
  '<line pathLength="1" x1="76" y1="24" x2="24" y2="76"/></svg>';
const O_SVG = '<svg class="mark mark-o" viewBox="0 0 100 100" aria-hidden="true">' +
  '<circle pathLength="1" cx="50" cy="50" r="28"/></svg>';

// Everything that changes while the game runs lives here
const state = {
  mode: null,              // 'pvp' or 'ai'
  humanSymbol: 'X',        // only used in AI mode
  aiSymbol: 'O',
  difficulty: 'medium',
  board: Array(9).fill(null),
  current: 'X',            // whose turn it is
  gameOver: false,
  aiTimer: null,           // id of the pending AI move, so we can cancel it
  scores: {},              // saved scoreboards, one per mode/difficulty/symbol
  settings: { sound: true, animations: true, theme: 'dark', difficulty: 'medium', symbol: 'X' }
};

/* ---------- 2. SAVING (localStorage) ---------- */

function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && typeof data === 'object') {
      if (data.scores) state.scores = data.scores;
      if (data.settings) Object.assign(state.settings, data.settings);
    }
  } catch (e) { /* no save or storage blocked: use defaults */ }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scores: state.scores, settings: state.settings }));
  } catch (e) { /* ignore: the game still works without saving */ }
}

// Each mode keeps its own scoreboard, so scores never get mixed up
function scoreKey() {
  return state.mode === 'pvp' ? 'pvp' : 'ai-' + state.difficulty + '-' + state.humanSymbol;
}

function currentScores() {
  const key = scoreKey();
  if (!state.scores[key]) state.scores[key] = { X: 0, O: 0, draws: 0 };
  return state.scores[key];
}

/* ---------- 3. SOUND (generated with the Web Audio API: works offline) ---------- */

let audioCtx = null;

function tone(freq, startAfter, duration, type, volume) {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime + startAfter;
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume || 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration);
  } catch (e) { /* audio not available: ignore */ }
}

const sounds = {
  click: () => tone(300, 0, 0.06, 'square', 0.04),
  place: (sym) => tone(sym === 'X' ? 520 : 390, 0, 0.14, 'triangle', 0.2),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15 + i * 0.12, 0.25, 'triangle', 0.18)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.15 + i * 0.18, 0.3, 'sawtooth', 0.08)),
  draw: () => [330, 294].forEach((f, i) => tone(f, 0.15 + i * 0.2, 0.3, 'sine', 0.18))
};

/* ---------- 4. AI ---------- */

function opponentOf(sym) { return sym === 'X' ? 'O' : 'X'; }
function hasWon(board, sym) { return WIN_LINES.some(line => line.every(i => board[i] === sym)); }
function emptyCells(board) { return board.map((v, i) => (v === null ? i : -1)).filter(i => i !== -1); }
function randomItem(list) { return list[Math.floor(Math.random() * list.length)]; }

// Returns the line [a,b,c] if `sym` has three in a row, otherwise null
function findWinLine(board, sym) {
  return WIN_LINES.find(line => line.every(i => board[i] === sym)) || null;
}

// Is there a cell where `sym` could win right now? Returns it, or null.
function findWinningMove(board, sym) {
  for (const i of emptyCells(board)) {
    board[i] = sym;                    // pretend to play there...
    const wins = hasWon(board, sym);
    board[i] = null;                   // ...then undo it
    if (wins) return i;
  }
  return null;
}

// Simple strategy: centre, then a corner, then an edge
function strategicMove(board) {
  if (board[CENTER] === null) return CENTER;
  const corners = CORNERS.filter(i => board[i] === null);
  if (corners.length) return randomItem(corners);
  return randomItem(EDGES.filter(i => board[i] === null));
}

// Try centre first, then corners, then edges (helps minimax pick sensible moves)
function orderMoves(cells) {
  const rank = (i) => (i === CENTER ? 0 : CORNERS.includes(i) ? 1 : 2);
  return cells.slice().sort((a, b) => rank(a) - rank(b));
}

/* Minimax: imagine every possible future of the game.
   +10 (minus depth) = AI wins, -10 (plus depth) = human wins, 0 = draw.
   Subtracting the depth makes the AI prefer quick wins and slow losses.
   Alpha-beta pruning just skips branches that cannot change the result. */
function minimax(board, depth, aiTurn, ai, human, alpha, beta) {
  if (hasWon(board, ai)) return 10 - depth;
  if (hasWon(board, human)) return depth - 10;
  const moves = emptyCells(board);
  if (moves.length === 0) return 0;

  if (aiTurn) {
    let best = -Infinity;
    for (const i of orderMoves(moves)) {
      board[i] = ai;
      best = Math.max(best, minimax(board, depth + 1, false, ai, human, alpha, beta));
      board[i] = null;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const i of orderMoves(moves)) {
    board[i] = human;
    best = Math.min(best, minimax(board, depth + 1, true, ai, human, alpha, beta));
    board[i] = null;
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function easyMove(board, ai) {
  // Mostly random, but occasionally spots an instant win
  const win = findWinningMove(board, ai);
  if (win !== null && Math.random() < 0.3) return win;
  return randomItem(emptyCells(board));
}

function mediumMove(board, ai) {
  const human = opponentOf(ai);
  const win = findWinningMove(board, ai);
  if (win !== null && Math.random() < 0.9) return win;
  const block = findWinningMove(board, human);
  if (block !== null && Math.random() < 0.75) return block;
  // Half the time play the centre/corner strategy, otherwise random
  return Math.random() < 0.5 ? strategicMove(board) : randomItem(emptyCells(board));
}

function hardMove(board, ai) {
  const human = opponentOf(ai);
  const empty = emptyCells(board);
  if (empty.length === 9) return randomItem([CENTER, ...CORNERS]);   // opening: centre or corner

  // Priority 1 and 2: win now, or block the opponent's win
  const win = findWinningMove(board, ai);
  if (win !== null) return win;
  const block = findWinningMove(board, human);
  if (block !== null) return block;

  // Priority 3+: minimax finds forks and avoids traps; ordering favours centre, then corners
  let bestScore = -Infinity;
  let bestMove = empty[0];
  for (const i of orderMoves(empty)) {
    board[i] = ai;
    const score = minimax(board, 1, false, ai, human, -Infinity, Infinity);
    board[i] = null;
    if (score > bestScore) { bestScore = score; bestMove = i; }
  }
  return bestMove;
}

function chooseAIMove() {
  const board = state.board.slice();     // work on a copy so the real board is never touched
  if (state.difficulty === 'easy') return easyMove(board, state.aiSymbol);
  if (state.difficulty === 'medium') return mediumMove(board, state.aiSymbol);
  return hardMove(board, state.aiSymbol);
}

/* ---------- 5. GAME FLOW ---------- */

const $ = (id) => document.getElementById(id);
const screens = { menu: $('screen-menu'), setup: $('screen-setup'), game: $('screen-game') };
const boardEl = $('board');
const cells = [];

function createBoard() {
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.setAttribute('role', 'gridcell');
    cell.addEventListener('click', () => onCellClick(i));
    boardEl.appendChild(cell);
    cells.push(cell);
  }
}

function cellLabel(i, value) {
  const where = 'row ' + (Math.floor(i / 3) + 1) + ', column ' + ((i % 3) + 1);
  return where + ', ' + (value || 'empty');
}

function startRound() {
  clearTimeout(state.aiTimer);           // cancel any AI move still waiting
  state.board.fill(null);
  state.current = 'X';                   // X always starts
  state.gameOver = false;

  cells.forEach((cell, i) => {
    cell.innerHTML = '';
    cell.className = 'cell';
    cell.disabled = false;
    cell.setAttribute('aria-label', cellLabel(i, null));
  });
  boardEl.classList.remove('won', 'draw');
  $('result').hidden = true;
  $('controls').hidden = false;
  $('status').hidden = false;

  updateUI();
  scheduleAIIfNeeded();                  // if the AI is X, it opens the round
}

function onCellClick(i) {
  if (state.gameOver) return;                                          // round finished
  if (state.board[i] !== null) return;                                 // cell already used
  if (state.mode === 'ai' && state.current !== state.humanSymbol) return;  // AI's turn
  placeMark(i);
}

function placeMark(i) {
  if (state.gameOver || state.board[i] !== null) return;
  const sym = state.current;
  state.board[i] = sym;

  cells[i].innerHTML = sym === 'X' ? X_SVG : O_SVG;
  cells[i].disabled = true;
  cells[i].setAttribute('aria-label', cellLabel(i, sym));
  sounds.place(sym);

  const line = findWinLine(state.board, sym);
  if (line) { endRound(sym, line); return; }
  if (emptyCells(state.board).length === 0) { endRound(null, null); return; }

  state.current = opponentOf(sym);       // switch turns
  updateUI();
  scheduleAIIfNeeded();
}

function scheduleAIIfNeeded() {
  if (state.mode === 'ai' && !state.gameOver && state.current === state.aiSymbol) {
    state.aiTimer = setTimeout(aiTakeTurn, AI_DELAY);
  }
}

function aiTakeTurn() {
  // Re-check everything: the player may have restarted or left in the meantime
  if (state.mode !== 'ai' || state.gameOver || state.current !== state.aiSymbol) return;
  placeMark(chooseAIMove());
}

function nameOf(sym) {
  if (state.mode === 'pvp') return sym === 'X' ? 'Player 1' : 'Player 2';
  return sym === state.humanSymbol ? 'You' : 'AI';
}

function endRound(winner, line) {
  state.gameOver = true;
  clearTimeout(state.aiTimer);
  const scores = currentScores();
  const result = $('result');

  if (winner) {
    scores[winner]++;
    line.forEach(i => cells[i].classList.add('win'));
    boardEl.classList.add('won');
    $('result-title').textContent = winner + ' WINS!';
    if (state.mode === 'pvp') $('result-sub').textContent = nameOf(winner) + ' takes the round.';
    else $('result-sub').textContent = winner === state.humanSymbol ? 'You beat the AI. Nicely played.' : 'The AI won this round.';
    result.className = 'result ' + winner.toLowerCase();
    if (state.mode === 'ai' && winner === state.aiSymbol) sounds.lose(); else sounds.win();
  } else {
    scores.draws++;
    boardEl.classList.add('draw');
    $('result-title').textContent = 'DRAW!';
    $('result-sub').textContent = 'The board is full and nobody won.';
    result.className = 'result draw';
    sounds.draw();
  }

  save();
  $('status').hidden = true;
  $('controls').hidden = true;
  result.hidden = false;
  updateUI();
}

function startPvp() {
  state.mode = 'pvp';
  showScreen('game');
  startRound();
}

function startAi() {
  state.mode = 'ai';
  state.difficulty = state.settings.difficulty;
  state.humanSymbol = state.settings.symbol;
  state.aiSymbol = opponentOf(state.humanSymbol);
  showScreen('game');
  startRound();
}

function goToMenu() {
  clearTimeout(state.aiTimer);
  state.gameOver = true;                 // stops any late AI move
  state.mode = null;
  showScreen('menu');
}

/* ---------- 6. SCREEN & UI HELPERS ---------- */

function showScreen(name) {
  Object.keys(screens).forEach(key => { screens[key].hidden = key !== name; });
}

function updateUI() {
  // Mode label and player names
  const diff = state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);
  $('game-mode').textContent = state.mode === 'pvp' ? 'Two Player' : 'You vs AI (' + diff + ')';
  $('name-x').textContent = nameOf('X');
  $('name-o').textContent = nameOf('O');

  // Whose turn
  if (!state.gameOver) {
    const sym = state.current;
    let text = nameOf(sym) + "'s turn";
    if (state.mode === 'ai') text = sym === state.humanSymbol ? 'Your turn' : 'AI is thinking...';
    $('status').innerHTML = '<span class="sym ' + sym.toLowerCase() + '">' + sym + '</span> ' + text;
  }

  // Board: hover preview symbol, and locked while the AI is playing or the round is over
  boardEl.classList.toggle('turn-x', state.current === 'X');
  boardEl.classList.toggle('turn-o', state.current === 'O');
  const aiTurn = state.mode === 'ai' && state.current === state.aiSymbol;
  boardEl.classList.toggle('locked', state.gameOver || aiTurn);

  // Scoreboard
  const s = currentScores();
  $('score-x').textContent = s.X;
  $('score-o').textContent = s.O;
  $('score-draw').textContent = s.draws;
}

function applySettings() {
  const s = state.settings;
  document.documentElement.setAttribute('data-theme', s.theme);
  document.body.classList.toggle('no-anim', !s.animations);
  $('btn-sound').textContent = 'Sound: ' + (s.sound ? 'On' : 'Off');
  $('btn-sound').setAttribute('aria-pressed', String(s.sound));
  $('btn-anim').textContent = 'Animations: ' + (s.animations ? 'On' : 'Off');
  $('btn-anim').setAttribute('aria-pressed', String(s.animations));
  $('btn-theme').textContent = 'Theme: ' + (s.theme === 'dark' ? 'Dark' : 'Light');
}

// Segmented buttons (difficulty / symbol) on the setup screen
function syncSegments() {
  [['group-difficulty', 'difficulty'], ['group-symbol', 'symbol']].forEach(([id, key]) => {
    $(id).querySelectorAll('.seg').forEach(btn => {
      btn.setAttribute('aria-checked', String(btn.dataset.value === state.settings[key]));
    });
  });
  $('diff-hint').textContent = DIFFICULTY_HINTS[state.settings.difficulty];
}

function bindSegments(groupId, key) {
  $(groupId).querySelectorAll('.seg').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings[key] = btn.dataset.value;
      syncSegments();
      save();
    });
  });
}

/* ---------- 7. EVENT LISTENERS & START-UP ---------- */

function init() {
  loadSave();
  createBoard();
  applySettings();
  syncSegments();

  $('btn-2p').addEventListener('click', startPvp);
  $('btn-ai').addEventListener('click', () => showScreen('setup'));
  $('btn-setup-back').addEventListener('click', () => showScreen('menu'));
  $('btn-start').addEventListener('click', startAi);
  $('btn-restart').addEventListener('click', startRound);
  $('btn-again').addEventListener('click', startRound);
  $('btn-menu').addEventListener('click', goToMenu);
  $('btn-result-menu').addEventListener('click', goToMenu);
  $('btn-reset-scores').addEventListener('click', () => {
    if (window.confirm('Reset the scoreboard for this mode?')) {
      state.scores[scoreKey()] = { X: 0, O: 0, draws: 0 };
      save();
      updateUI();
    }
  });

  bindSegments('group-difficulty', 'difficulty');
  bindSegments('group-symbol', 'symbol');

  $('btn-sound').addEventListener('click', () => { state.settings.sound = !state.settings.sound; applySettings(); save(); });
  $('btn-anim').addEventListener('click', () => { state.settings.animations = !state.settings.animations; applySettings(); save(); });
  $('btn-theme').addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; applySettings(); save(); });

  // Soft click sound for every normal button (board cells make their own sound)
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') && !e.target.closest('.cell')) sounds.click();
  });
}

init();

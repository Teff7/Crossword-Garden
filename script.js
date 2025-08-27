
// script.js — updated to load from the new CLUES JSON and map Crossword `000001`
const FILE = '/CLUES.JSON'; // exact filename uploaded
const DEFAULT_CROSSWORD_ID = '000001';
fetch(FILE, { cache: 'no-store' }) // or add ?t=Date.now() while testing

// Elements
const welcome = document.getElementById('welcome');
const game = document.getElementById('game');
const gridEl = document.getElementById('grid');
const clueHeaderEl = document.getElementById('clueHeader');
const clueTextEl = document.getElementById('clueText');
const mobileInput = document.getElementById('mobileInput');
const btnPlay = document.getElementById('btnPlay');
const topMenuWrap = document.getElementById('topMenuWrap');
const btnMenu = document.getElementById('btnMenu');
const menuPanel = document.getElementById('menuPanel');
const menuHelp = document.getElementById('menuHelp');
const menuRestart = document.getElementById('menuRestart');
const hintDropdown = document.getElementById('hintDropdown');
const puzzleDateEl = document.getElementById('puzzleDate');

// Help + Hints
const btnHelp = document.getElementById('btnHelp');
const btnHelpGame = document.getElementById('btnHelpGame');
const btnHelpBottom = document.getElementById('btnHelpBottom');
const helpModal = document.getElementById('helpModal');
const helpClose = document.getElementById('helpClose');

const btnHints = document.getElementById('btnHints');
const hintMenu = document.getElementById('hintMenu');
const btnHintDef = document.getElementById('hintDef');
const btnHintLetter = document.getElementById('hintLetter');
const btnHintAnalyse = document.getElementById('hintWordplay');

const btnBack = document.getElementById('btnBack');

// Additional controls
const btnGiveUp = document.getElementById('btnGiveUp');
const btnShare = document.getElementById('btnShare');

// State
let puzzle = null;
let grid = [];
let cellMap = new Map();
let entries = [];
let currentEntry = null;
let activeCellKey = null;
let lastClickedCellKey = null;
const dirToggle = new Map();
let showAnnot = false;
let showDefOnly = false;

// fixed 5×5 template used by the 3×3 clue layout
const GRID_TEMPLATE = {
  rows: 5, cols: 5,
  blocks: [[1,1],[1,3],[3,1],[3,3]],
  numbers: { all: [[0,0,'1'],[0,2,'2'],[0,4,'3'],[2,0,'2'],[4,0,'3']] }
};

const TIP = {
  acrostic: 'Take first letters.',
  hidden: 'Look within the fodder.',
  anagram: 'Shuffle the letters.',
  deletion: 'Remove letters.',
  charade: 'Build from parts.',
  reversal: 'Reverse the letters.',
  container: 'Find it within.',
  lit: 'Whole clue is both definition and wordplay.'
};

function key(r,c){ return `${r},${c}`; }

// Exposed in HTML: onclick="startGame()"
function startGame(){
  welcome.hidden = true;
  game.hidden = false;
  if (mobileInput) mobileInput.focus();
}
window.startGame = startGame;

// Wire Play immediately so it works even before data loads
if (btnPlay) btnPlay.addEventListener('click', startGame);

// Robust fallback: delegate click to handle dynamic or missed bindings
document.addEventListener('click', function(e){
  const target = e.target;
  if (!target) return;
  if (target.id === 'btnPlay' || (target.closest && target.closest('#btnPlay'))){
    startGame();
  }
});

// ----- Grid build -----
function buildGrid(){
  const { rows, cols, blocks = [], numbers = {} } = puzzle.grid;
  const blockSet = new Set(blocks.map(([r,c]) => key(r,c)));
  gridEl.innerHTML = '';
  grid = [];
  cellMap.clear();

  for (let r=0;r<rows;r++){
    const rowArr = [];
    for (let c=0;c<cols;c++){
      const k = key(r,c);
      const cell = { r,c, block:blockSet.has(k), letter:'', entries:[], el:document.createElement('div'), nums:[] };
      cell.el.className = 'cell' + (cell.block ? ' block' : '');
      cell.el.setAttribute('role','gridcell');
      if (!cell.block) cell.el.addEventListener('click', () => handleCellClick(k));
      gridEl.appendChild(cell.el);
      rowArr.push(cell);
      cellMap.set(k, cell);
    }
    grid.push(rowArr);
  }

  // Numbers (if present)
  const all = numbers.all || [];
  all.forEach(([r,c,label]) => {
    const cell = cellMap.get(key(r,c));
    if (!cell || cell.block) return;
    cell.nums.push(String(label));
    const numEl = document.createElement('div');
    numEl.className = 'num';
    numEl.textContent = String(label);
    cell.el.appendChild(numEl);
  });
}

function placeEntries(){
  entries = (puzzle.entries||[]).map(e => ({
    id: e.id,
    direction: e.direction, // 'across'|'down'
    row: e.row,
    col: e.col,
    answer: e.answer.toUpperCase(),
    surface: e.surface,
    category: e.category, // for per-type colour
    annotations: e.annotations || [],
    cells: [],
    iActive: 0
  }));

  entries.forEach(ent => {
    for (let i=0;i<ent.answer.length;i++){
      const r = ent.row + (ent.direction==='down' ? i : 0);
      const c = ent.col + (ent.direction==='across' ? i : 0);
      const cell = cellMap.get(key(r,c));
      if (!cell || cell.block) continue;
      ent.cells.push(cell);
      cell.entries.push(ent);
    }
  });
}

function renderClue(ent){
  // Always show the exact surface string by default.
  // When hints are toggled, overlay spans on the surface text.
  const dirLabel = ent.direction[0].toUpperCase() + ent.direction.slice(1);
  clueHeaderEl.textContent = `${ent.id} — ${dirLabel}`;

  // Base class + clue type for colour scheme
  const typeClass = ent.category;
  clueTextEl.className = `clue ${typeClass}`;

  // Decide whether to annotate and/or show def only
  const html = buildAnnotatedHTML(ent.surface, ent.annotations, {
    annotate: showAnnot,
    defOnly: showDefOnly
  });
  clueTextEl.innerHTML = html;
}

function buildAnnotatedHTML(surface, annotations, opts){
  const { annotate=false, defOnly=false } = opts || {};
  if (!annotate && !defOnly){
    return escapeHtml(surface);
  }
  // Compute ranges to wrap in the original surface string
  const spans = [];
  function overlaps(a,b){ return !(a[1] <= b[0] || b[1] <= a[0]); }

  const allowed = annotations.filter(a => {
    if (defOnly) return a.kind === 'definition';
    return true;
  });

  // Build find list with indices
  allowed.forEach(a => {
    const text = a.text || '';
    if (!text) return;
    // Find first occurrence (case sensitive); if not found try case-insensitive
    let start = surface.indexOf(text);
    if (start < 0){
      const re = new RegExp(text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&'), 'i');
      const m = surface.match(re);
      if (m) start = m.index;
    }
    if (start < 0) return;
    const end = start + text.length;
    const klass = (a.kind === 'definition' ? 'def' : (a.kind === 'fodder' ? 'fodder' : 'indicator'));
    spans.push({ start, end, klass, tip: a.tooltip || TIP[a.kind] || '', text });
  });

  // Sort and drop overlaps
  spans.sort((x,y)=> x.start - y.start || y.end - x.end);
  const final = [];
  spans.forEach(s => {
    if (final.every(f => !overlaps([s.start,s.end],[f.start,f.end]))){
      final.push(s);
    }
  });

  // Stitch together
  let out = '';
  let pos = 0;
  final.forEach(s => {
    if (pos < s.start) out += escapeHtml(surface.slice(pos, s.start));
    out += `<span class="${s.klass}" data-tooltip="${escapeHtml(s.tip||'')}">${escapeHtml(surface.slice(s.start, s.end))}</span>`;
    pos = s.end;
  });
  if (pos < surface.length) out += escapeHtml(surface.slice(pos));
  return out;
}

function renderLetters(){
  grid.flat().forEach(cell => {
    [...cell.el.childNodes].forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('num')) return;
      cell.el.removeChild(n);
    });
    cell.el.classList.remove('active');
  });
  grid.flat().forEach(cell => {
    if (cell.letter) {
      const d = document.createElement('div');
      d.className = 'letter';
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.width = '100%';
      d.style.height = '100%';
      d.style.fontWeight = '700';
      d.textContent = cell.letter;
      cell.el.appendChild(d);
    }
  });
  highlightActive();
}

function setCurrentEntry(ent, fromCellKey=null){
  currentEntry = ent;
  if (!ent) return;
  if (puzzleDateEl) puzzleDateEl.textContent = `Crossword ${puzzle.id || DEFAULT_CROSSWORD_ID}`;
  if (fromCellKey){
    const i = ent.cells.findIndex(c => key(c.r,c.c)===fromCellKey);
    ent.iActive = (i>=0 ? i : 0);
  } else if (ent.iActive==null){
    ent.iActive = 0;
  }
  const cell = ent.cells[ent.iActive];
  activeCellKey = key(cell.r,cell.c);
  renderClue(ent);
  renderLetters();
}

function highlightActive(){
  if (!currentEntry) return;
  const cell = currentEntry.cells[currentEntry.iActive];
  if (cell) cell.el.classList.add('active');
}

function handleCellClick(k){
  const cell = cellMap.get(k);
  if (!cell || cell.block) return;
  const belongs = cell.entries || [];
  if (!belongs.length) return;

  let pref = dirToggle.get(k) || 'across';
  if (lastClickedCellKey === k) pref = pref==='across' ? 'down' : 'across';
  lastClickedCellKey = k;

  const ent = belongs.find(e => e.direction===pref) || belongs[0];
  dirToggle.set(k, ent.direction);
  setCurrentEntry(ent, k);
}

function nextCell(inc){
  if (!currentEntry) return null;
  let i = currentEntry.iActive + inc;
  i = Math.max(0, Math.min(i, currentEntry.cells.length-1));
  currentEntry.iActive = i;
  const cell = currentEntry.cells[i];
  activeCellKey = key(cell.r,cell.c);
  return cell;
}

function typeChar(ch){
  if (!currentEntry) return;
  const cell = currentEntry.cells[currentEntry.iActive];
  cell.letter = ch.toUpperCase();
  nextCell(+1);
  renderLetters();
}

function backspace(){
  if (!currentEntry) return;
  const cell = currentEntry.cells[currentEntry.iActive];
  cell.letter = '';
  nextCell(-1);
  renderLetters();
}

function submitAnswer(){
  if (!currentEntry) return;
  const guess = currentEntry.cells.map(c => c.letter||' ').join('').toUpperCase();
  const target = currentEntry.answer.toUpperCase();
  if (guess === target){
    game.classList.add('flash-green');
    setTimeout(() => {
      game.classList.remove('flash-green');
      const idx = entries.indexOf(currentEntry);
      const next = entries[idx+1];
      if (next) setCurrentEntry(next); else finishGame();
    }, 650);
  } else {
    game.classList.add('flash-red');
    setTimeout(() => game.classList.remove('flash-red'), 450);
  }
}

function finishGame(){
  var fireworks = document.getElementById('fireworks');
  if (fireworks) fireworks.classList.add('on');
}

// ----- Help & hints & misc -----
function setupHandlers(){
  const openHelp = () => { if (helpModal) helpModal.hidden = false; };
  const closeHelp = () => { if (helpModal) helpModal.hidden = true; };
  if (btnHelp) btnHelp.addEventListener('click', openHelp);
  if (btnHelpGame) btnHelpGame && btnHelpGame.addEventListener('click', openHelp);
  if (btnHelpBottom) btnHelpBottom.addEventListener('click', openHelp);
  if (helpClose) helpClose.addEventListener('click', closeHelp);

  // Hints dropdown
  if (btnHints) btnHints.addEventListener('click', () => {
    const expanded = btnHints.getAttribute('aria-expanded') === 'true';
    btnHints.setAttribute('aria-expanded', String(!expanded));
    if (hintMenu) hintMenu.setAttribute('aria-hidden', String(expanded));
    if (hintDropdown){
      if (expanded) hintDropdown.classList.remove('open'); else hintDropdown.classList.add('open');
    }
  });
  if (btnHintDef) btnHintDef.addEventListener('click', () => {
    showDefOnly = !showDefOnly;
    clueTextEl.classList.toggle('help-on', showDefOnly);
    if (currentEntry) renderClue(currentEntry);
  });
  if (btnHintLetter) btnHintLetter.addEventListener('click', () => {
    if (!currentEntry) return;
    const empties = currentEntry.cells.map((c,i)=>c.letter?null:i).filter(i=>i!==null);
    if (!empties.length) return;
    const idx = empties[Math.floor(Math.random()*empties.length)];
    currentEntry.cells[idx].letter = currentEntry.answer[idx];
    currentEntry.iActive = idx;
    activeCellKey = key(currentEntry.cells[idx].r, currentEntry.cells[idx].c);
    renderLetters();
  });
  if (btnHintAnalyse) btnHintAnalyse.addEventListener('click', () => {
    showAnnot = !showAnnot;
    clueTextEl.classList.toggle('annot-on', showAnnot);
    if (currentEntry) renderClue(currentEntry);
  });

  // Top Menu dropdown
  if (btnMenu) btnMenu.addEventListener('click', () => {
    const expanded = btnMenu.getAttribute('aria-expanded') === 'true';
    btnMenu.setAttribute('aria-expanded', String(!expanded));
    if (menuPanel) menuPanel.setAttribute('aria-hidden', String(expanded));
    if (topMenuWrap){
      if (expanded) topMenuWrap.classList.remove('open'); else topMenuWrap.classList.add('open');
    }
  });
  if (menuHelp) menuHelp.addEventListener('click', () => {
    openHelp();
  });
  if (menuRestart) menuRestart.addEventListener('click', () => {
    restartGame();
    if (btnMenu) btnMenu.setAttribute('aria-expanded','false');
    if (menuPanel) menuPanel.setAttribute('aria-hidden','true');
    if (topMenuWrap) topMenuWrap.classList.remove('open');
  });

  // Reveal answer
  if (btnGiveUp) btnGiveUp.addEventListener('click', () => {
    if (!currentEntry) return;
    currentEntry.cells.forEach((cell, idx) => {
      cell.letter = currentEntry.answer[idx];
    });
    renderLetters();
    submitAnswer();
  });

  // Share result
  if (btnShare) btnShare.addEventListener('click', () => {
    if (!puzzle) return;
    const rows = [];
    for (let r = 0; r < grid.length; r++) {
      let row = '';
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];
        if (cell.block) row += '⬛';
        else if (cell.letter) row += cell.letter;
        else row += '⬜';
      }
      rows.push(row);
    }
    const header = `Daily 5×5 Cryptic ${puzzle.id ? '('+puzzle.id+')' : ''}`.trim();
    const shareText = header + '\n' + rows.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('Copied your grid to the clipboard!');
      }).catch(err => {
        console.warn('Clipboard copy failed', err);
        alert('Unable to copy your results');
      });
    } else {
      const temp = document.createElement('textarea');
      temp.value = shareText;
      temp.style.position = 'fixed';
      temp.style.top = '-1000px';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      try {
        document.execCommand('copy');
        alert('Copied your grid to the clipboard!');
      } catch (e) {
        alert('Unable to copy your results');
      }
      document.body.removeChild(temp);
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (hintDropdown && !hintDropdown.contains(t)){
      if (hintDropdown.classList.contains('open')){
        hintDropdown.classList.remove('open');
        if (btnHints) btnHints.setAttribute('aria-expanded','false');
        if (hintMenu) hintMenu.setAttribute('aria-hidden','true');
      }
    }
    if (topMenuWrap && !topMenuWrap.contains(t)){
      if (topMenuWrap.classList.contains('open')){
        topMenuWrap.classList.remove('open');
        if (btnMenu) btnMenu.setAttribute('aria-expanded','false');
        if (menuPanel) menuPanel.setAttribute('aria-hidden','true');
      }
    }
  });

  // Back
  if (btnBack) btnBack.addEventListener('click', () => {
    game.hidden = true;
    welcome.hidden = false;
  });

  // Typing
  if (mobileInput) mobileInput.addEventListener('input', e => {
    const char = e.data || e.target.value;
    if (/^[a-zA-Z]$/.test(char)) typeChar(char);
    e.target.value = '';
  });
  document.addEventListener('keydown', e => {
    if (/^[a-zA-Z]$/.test(e.key)) typeChar(e.key);
    else if (e.key === 'Backspace'){ e.preventDefault(); backspace(); }
    else if (e.key === 'Enter'){ submitAnswer(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ nextCell(-1); renderLetters(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){ nextCell(+1); renderLetters(); }
  });
}
function restartGame(){
  entries.forEach(ent => ent.cells.forEach(c => { c.letter = ''; }));
  showAnnot = false;
  showDefOnly = false;
  clueTextEl.classList.remove('annot-on','help-on');
  setCurrentEntry(entries[0]);
  renderLetters();
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]
  ));
}

// ----- Data mapping: new CLUES JSON -> puzzle object -----
function normaliseType(t){
  if (!t) return '';
  const x = String(t).toLowerCase().trim();
  if (x === 'literally' || x === '&lit' || x === 'lit') return 'lit';
  return x;
}
function parseAnnotations(row){
  const ann = [];
  for (let i=0; i<5; i++){
    const suffix = i===0 ? '' : `.${i}`;
    const type = row[`Tooltip_${i+1}_type`];
    const section = row[`Tooltip_section${suffix}`];
    const text = row[`Tooltip_Text${suffix}`];
    if (!type || !section) continue;
    ann.push({
      kind: normaliseType(type),
      text: String(section),
      tooltip: String(text || '')
    });
  }
  return ann;
}
function buildPuzzleFromBook(book, crosswordId){
  const rows = (((book||{}).sheets||[])[0]||{}).rows||[];
  const wanted = rows.filter(r => String(r['Crossword']) === String(crosswordId));
  const acrossRows = wanted.filter(r => String(r['Position']).toUpperCase()==='A');
  const downRows   = wanted.filter(r => String(r['Position']).toUpperCase()==='D');

  // map fixed coordinates
  const AC_ROWS = [0,2,4];
  const AC_COL = 0;
  const DN_ROW = 0;
  const DN_COLS = [0,2,4];

  const makeEntry = (r, idx, isAcross) => {
    const id = `${idx+1}${isAcross?'A':'D'}`;
    const direction = isAcross ? 'across' : 'down';
    const row = isAcross ? AC_ROWS[idx] : DN_ROW;
    const col = isAcross ? AC_COL : DN_COLS[idx];
    const category = normaliseType(r['Clue Type']);
    return {
      id, direction, row, col,
      answer: String(r['Solution']||'').toUpperCase(),
      surface: String(r['Clue']||''),
      category,
      annotations: parseAnnotations(r)
    };
  };

  const entries = [
    ...acrossRows.map((r,i)=>makeEntry(r,i,true)),
    ...downRows.map((r,i)=>makeEntry(r,i,false))
  ];

  return {
    id: crosswordId,
    grid: GRID_TEMPLATE,
    entries
  };
}

// ----- Boot -----
window.addEventListener('load', () => {
  setupHandlers();

  fetch(FILE)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load ${FILE}: ${r.status}`);
      return r.json();
    })
    .then(json => {
      puzzle = buildPuzzleFromBook(json, DEFAULT_CROSSWORD_ID);
      buildGrid();
      placeEntries();
      setCurrentEntry((puzzle.entries || [])[0]);
    })
    .catch(err => {
      console.warn('Failed to load new CLUES JSON:', err);
      puzzle = {
        id: 'fallback',
        grid: { rows: 5, cols: 5, blocks: [] },
        entries: [{ id: '1A', direction: 'across', row: 0, col: 0, answer: 'HELLO', surface: 'Wave politely (5)', category:'charade', annotations: [] }]
      };
      buildGrid();
      placeEntries();
      setCurrentEntry(puzzle.entries[0]);
    });
});




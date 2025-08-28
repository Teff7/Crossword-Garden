// script.js — robust loader; always renders something

const FILE = 'CLUES.JSON';
const DEFAULT_CROSSWORD_ID = '000001';
const ENABLE_FALLBACK = true; // keep true until you're 100% sure JSON loads in prod

// Elements
const game = document.getElementById('game');
const gridEl = document.getElementById('grid');
const clueHeaderEl = document.getElementById('clueHeader');
const clueTextEl = document.getElementById('clueText');
const mobileInput = document.getElementById('mobileInput');
const topMenuWrap = document.getElementById('topMenuWrap');
const btnMenu = document.getElementById('btnMenu');
const menuPanel = document.getElementById('menuPanel');
const menuRestart = document.getElementById('menuRestart');
const hintDropdown = document.getElementById('hintDropdown');
const hintMenu = document.getElementById('hintMenu');
const btnHintDef = document.getElementById('hintDef');
const btnHintLetter = document.getElementById('hintLetter');
const btnHintAnalyse = document.getElementById('hintWordplay');
const btnBack = document.getElementById('btnBack');
const puzzleDateEl = document.getElementById('puzzleDate');

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
let hasLoaded = false;

// Fixed 5×5 template
const GRID_TEMPLATE = {
  rows: 5, cols: 5,
  blocks: [[1,1],[1,3],[3,1],[3,3]],
  numbers: { all: [[0,0,'1'],[0,2,'2'],[0,4,'3'],[2,0,'2'],[4,0,'3']] }
};

// Minimal fallback “always render” puzzle (safe while you debug hosting)
const MINI_FALLBACK = {
  id: 'fallback',
  grid: { rows: 5, cols: 5, blocks: [] },
  entries: [{
    id: '1A', direction: 'across', row: 0, col: 0,
    answer: 'HELLO',
    surface: 'Wave politely (5)',
    category: 'lit',
    annotations: [
      { kind: 'definition', text: 'Wave politely', tooltip: 'Definition' }
    ]
  }]
};

const TIP = {
  acrostic: 'Take first letters.',
  hidden: 'Look within the fodder.',
  anagram: 'Shuffle the letters.',
  deletion: 'Remove letters.',
  charade: 'Build from parts.',
  reversal: 'Reverse the letters.',
  container: 'Find it within.',
  lit: 'Whole clue is both definition and wordplay.',
  definition: 'Definition of the answer.',
  fodder: 'Letters used to build the answer.',
  indicator: 'Word telling you what to do.'
};

function key(r,c){ return `${r},${c}`; }

// ---------- GRID ----------
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

  const all = (numbers.all || []);
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
    direction: e.direction,
    row: e.row,
    col: e.col,
    answer: String(e.answer||'').toUpperCase(),
    surface: e.surface || '',
    category: e.category || '',
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

// ---------- CLUE RENDER ----------
function renderClue(ent){
  if (!ent) return;
  const dirLabel = ent.direction[0].toUpperCase() + ent.direction.slice(1);
  clueHeaderEl.textContent = `${ent.id} — ${dirLabel}`;

  const typeClass = ent.category || '';
  const keepAnnot = clueTextEl.classList.contains('annot-on');
  const keepHelp = clueTextEl.classList.contains('help-on');
  clueTextEl.className = `clue ${typeClass}`;
  if (keepAnnot) clueTextEl.classList.add('annot-on');
  if (keepHelp) clueTextEl.classList.add('help-on');

  const html = buildAnnotatedHTML(ent.surface, ent.annotations, {
    annotate: showAnnot,
    defOnly: showDefOnly
  });
  clueTextEl.innerHTML = html;
}

function buildAnnotatedHTML(surface, annotations, opts){
  const { annotate=false, defOnly=false } = opts || {};
  if (!annotate && !defOnly) return escapeHtml(surface||'');

  const spans = [];
  const sfc = String(surface||'');
  const allowed = (annotations||[]).filter(a => defOnly ? a.kind==='definition' : true);

  function overlaps(a,b){ return !(a[1] <= b[0] || b[1] <= a[0]); }

  allowed.forEach(a => {
    const text = String(a.text||'');
    if (!text) return;
    let start = sfc.indexOf(text);
    if (start < 0){
      const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
      const m = sfc.match(re);
      if (m) start = m.index;
    }
    if (start < 0) return;
    const end = start + text.length;
    const klass = (a.kind==='definition' ? 'def' : a.kind==='fodder' ? 'fodder' : 'indicator');
    spans.push({ start, end, klass, tip: a.tooltip || TIP[a.kind] || '', text });
  });

  spans.sort((x,y)=> x.start - y.start || y.end - x.end);
  const final = [];
  spans.forEach(s => {
    if (final.every(f => !overlaps([s.start,s.end],[f.start,f.end]))) final.push(s);
  });

  let out = ''; let pos = 0;
  final.forEach(s => {
    if (pos < s.start) out += escapeHtml(sfc.slice(pos, s.start));
    out += `<span class="${s.klass}" data-tooltip="${escapeHtml(s.tip||'')}">${escapeHtml(sfc.slice(s.start, s.end))}</span>`;
    pos = s.end;
  });
  if (pos < sfc.length) out += escapeHtml(sfc.slice(pos));
  return out;
}

// ---------- LETTERS ----------
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
  currentEntry.cells.forEach(c => c.el.classList.remove('active'));
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
  const fireworks = document.getElementById('fireworks');
  if (fireworks) fireworks.classList.add('on');
}

// ---------- HINTS + UI ----------
function setupHandlers(){
  // Hints dropdown toggle
  const btnHints = document.getElementById('btnHints');
  if (btnHints && hintDropdown && hintMenu) {
    btnHints.addEventListener('click', () => {
      const isOpen = hintDropdown.classList.toggle('open');
      btnHints.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      hintMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });
    hintMenu.addEventListener('click', e => e.stopPropagation());
  }

  // Definition only
  if (btnHintDef) btnHintDef.addEventListener('click', () => {
    clueTextEl.classList.add('help-on');
    clueTextEl.classList.remove('annot-on');
    showAnnot = false;
    showDefOnly = true;
    if (currentEntry) renderClue(currentEntry);
  });

  // Reveal a letter (first empty)
  if (btnHintLetter) btnHintLetter.addEventListener('click', () => {
    if (!currentEntry) return;
    const i = currentEntry.cells.findIndex(c => !c.letter);
    if (i >= 0) {
      const ch = currentEntry.answer[i] || '';
      currentEntry.cells[i].letter = ch.toUpperCase();
      currentEntry.iActive = i;
      renderLetters();
    }
  });

  // Analyse / reveal the trick
  if (btnHintAnalyse) btnHintAnalyse.addEventListener('click', () => {
    clueTextEl.classList.add('annot-on');
    clueTextEl.classList.remove('help-on');
    showAnnot = true;
    showDefOnly = false;
    if (currentEntry) renderClue(currentEntry);
  });

  // Menu open/close
  if (btnMenu && topMenuWrap && menuPanel) {
    btnMenu.addEventListener('click', () => {
      const isOpen = topMenuWrap.classList.toggle('open');
      btnMenu.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      menuPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });
    document.addEventListener('click', e => {
      if (!topMenuWrap.contains(e.target)){
        topMenuWrap.classList.remove('open');
        btnMenu.setAttribute('aria-expanded','false');
        menuPanel.setAttribute('aria-hidden','true');
      }
    });
  }

  // Back hides game (safe no-op if no welcome)
  if (btnBack) btnBack.addEventListener('click', () => {
    if (game) game.hidden = true;
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

// ---------- JSON -> PUZZLE ----------
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
    ann.push({ kind: normaliseType(type), text: String(section), tooltip: String(text||'') });
  }
  return ann;
}

function buildPuzzleFromBook(book, crosswordId){
  const rows = (((book||{}).sheets||[])[0]||{}).rows||[];
  // primary filter
  let wanted = rows.filter(r => String(r['Crossword']).trim() === String(crosswordId).trim());

  // safety: if no rows matched id, take first 6 rows so we still render
  if (!wanted.length) wanted = rows.slice(0, 6);

  const acrossRows = wanted.filter(r => String(r['Position']).toUpperCase()==='A');
  const downRows   = wanted.filter(r => String(r['Position']).toUpperCase()==='D');

  const AC_ROWS = [0,2,4];
  const AC_COL = 0;
  const DN_ROW = 0;
  const DN_COLS = [0,2,4];

  const makeEntry = (r, idx, isAcross) => {
    const id = `${idx+1}${isAcross?'A':'D'}`;
    const direction = isAcross ? 'across' : 'down';
    const row = isAcross ? AC_ROWS[idx] : DN_ROW;
    const col = isAcross ? AC_COL : DN_COLS[idx];
    return {
      id, direction, row, col,
      answer: String(r['Solution']||'').toUpperCase(),
      surface: String(r['Clue']||''),
      category: normaliseType(r['Clue Type']),
      annotations: parseAnnotations(r)
    };
  };

  const entries = [
    ...acrossRows.slice(0,3).map((r,i)=>makeEntry(r,i,true)),
    ...downRows.slice(0,3).map((r,i)=>makeEntry(r,i,false))
  ];

  return {
    id: crosswordId,
    grid: GRID_TEMPLATE,
    entries
  };
}

// ---------- BOOT ----------
window.addEventListener('load', () => {
  // game is visible immediately (no welcome section)
  setupHandlers();

  fetch(FILE, { cache: 'no-store' })
    .then(async (r) => {
      const ct = r.headers.get('content-type') || '';
      const body = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (ct.includes('text/html') || body.trim().startsWith('<')) {
        throw new Error('Got HTML instead of JSON');
      }
      let json;
      try { json = JSON.parse(body); }
      catch (e) { throw new Error('JSON parse error: ' + e.message); }
      return json;
    })
    .then(json => {
      puzzle = buildPuzzleFromBook(json, DEFAULT_CROSSWORD_ID);
      buildGrid();
      placeEntries();
      setCurrentEntry((puzzle.entries || [])[0]);
      hasLoaded = true;
    })
    .catch(err => {
      console.warn('[CLUES] load failed:', err);
      if (ENABLE_FALLBACK && !hasLoaded) {
        puzzle = MINI_FALLBACK;
        buildGrid();
        placeEntries();
        setCurrentEntry(puzzle.entries[0]);
        hasLoaded = true;
      }
    });
});

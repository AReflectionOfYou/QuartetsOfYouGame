// Quartets of You: all app logic. No modules, no build step.
//
// Routing is driven by the query string:
//   index.html                 -> the Repertoire (puzzle picker)
//   index.html?puzzle=<id>     -> fetches puzzles/<id>.json and plays it
//   index.html?compose         -> Compose mode, for writing new puzzles

// The Repertoire. Add a line here for each puzzle file in puzzles/.
const PUZZLES = [
  { id: "opening-night", title: "Opening Night" },
  { id: "practice-room", title: "Practice Room" }
];

// Voices, from easiest to hardest. A group's voice sets its color and label.
const VOICES = ["bass", "tenor", "alto", "soprano"];
const VOICE_LABELS = { bass: "Bass", tenor: "Tenor", alto: "Alto", soprano: "Soprano" };

const MAX_MISTAKES = 4;
const REVEAL_DELAY_MS = 900;

let puzzle = null;
let words = [];
let selected = new Set();
let solvedGroupNames = new Set();   // insertion order = order solved
let tuttiSolvedNames = new Set();
let mistakesRemaining = MAX_MISTAKES;
let mode = "start";                 // "start" | "tutti" | "standard" | "over"
let tuttiPick = null;               // index into words of the first tapped tile in Tutti
let tuttiBravo = false;
let playingFromCompose = false;

const qs = new URLSearchParams(window.location.search);
const puzzleId = qs.get("puzzle");

const $ = id => document.getElementById(id);
const el = {
  title: $("puzzle-title"),
  subtitle: $("puzzle-subtitle"),
  list: $("puzzle-list"),
  links: $("puzzle-links"),
  game: $("game"),
  startPanel: $("start-panel"),
  startStandard: $("start-standard-btn"),
  startTutti: $("start-tutti-btn"),
  tuttiIntro: $("tutti-intro"),
  grid: $("grid"),
  solved: $("solved-groups"),
  mistakes: $("mistakes"),
  message: $("message"),
  standardControls: $("standard-controls"),
  tuttiControls: $("tutti-controls"),
  shuffle: $("shuffle-btn"),
  clear: $("clear-btn"),
  submit: $("submit-btn"),
  tuttiShuffle: $("tutti-shuffle-btn"),
  tuttiSkip: $("tutti-skip-btn"),
  tuttiSubmit: $("tutti-submit-btn"),
  end: $("end-screen"),
  endTitle: $("end-title"),
  endMessage: $("end-message"),
  endGroups: $("end-groups"),
  batonMark: $("baton-mark"),
  playAgain: $("play-again-btn"),
  bravo: $("bravo"),
  bravoClose: $("bravo-close-btn"),
  modal: $("details-modal"),
  detailsText: $("details-text"),
  detailsClose: $("details-close-btn"),
  pageBg: $("page-bg"),
  helpBtn: $("help-btn"),
  gameHelpBtn: $("game-help-btn"),
  helpModal: $("help-modal"),
  helpClose: $("help-close-btn"),
  compose: $("compose")
};

let detailsCloseCallback = null;

// ---------------------------------------------------------------- helpers

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(word) {
  return String(word).trim().toLowerCase();
}

function groupKey(list) {
  return list.map(normalize).sort().join("|");
}

// A group's voice: its "voice" field if it has one, otherwise its position
// in the file (first group = Bass, ... fourth = Soprano).
function voiceOf(group) {
  const v = typeof group.voice === "string" ? group.voice.toLowerCase() : "";
  if (VOICES.includes(v)) return v;
  return VOICES[puzzle.groups.indexOf(group)] || "bass";
}

function voiceBadge(voice) {
  const badge = document.createElement("span");
  badge.className = `voice-badge voice-${voice}`;
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = VOICE_LABELS[voice][0];
  return badge;
}

// ---------------------------------------------------------------- Repertoire

function showPuzzleList() {
  el.title.textContent = "Quartets of You";
  el.subtitle.textContent = "Sort sixteen words into four quartets, from Bass to Soprano. Pick a piece from the Repertoire, or compose your own.";
  el.list.classList.remove("hidden");
  el.pageBg.style.backgroundImage = "none";
  el.links.innerHTML = "";
  PUZZLES.forEach(p => {
    const a = document.createElement("a");
    a.href = `index.html?puzzle=${encodeURIComponent(p.id)}`;
    const stripe = document.createElement("span");
    stripe.className = "repertoire-stripe";
    stripe.setAttribute("aria-hidden", "true");
    VOICES.forEach(v => {
      const bar = document.createElement("span");
      bar.className = `voice-${v}`;
      stripe.appendChild(bar);
    });
    const name = document.createElement("span");
    name.textContent = p.title;
    a.append(stripe, name);
    el.links.appendChild(a);
  });
}

// ---------------------------------------------------------------- loading

async function loadPuzzle(id) {
  const response = await fetch(`puzzles/${id}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Puzzle not found: ${id}`);
  const data = await response.json();
  validatePuzzle(data);
  puzzle = data;
  resetGame();
}

function validatePuzzle(data) {
  if (!data || !Array.isArray(data.groups) || data.groups.length !== 4) {
    throw new Error("Puzzle must have exactly four groups.");
  }
  const all = [];
  const voices = [];
  data.groups.forEach(group => {
    if (!group.name || !Array.isArray(group.words) || group.words.length !== 4) {
      throw new Error("Each group needs a name and exactly four words.");
    }
    if (group.words.some(w => typeof w !== "string" || !w.trim())) {
      throw new Error("Every word must be non-empty text.");
    }
    if (group.details !== undefined && typeof group.details !== "string") {
      throw new Error("A group's details, if present, must be a text string.");
    }
    if (group.voice !== undefined) {
      const v = String(group.voice).toLowerCase();
      if (!VOICES.includes(v)) throw new Error(`Unknown voice "${group.voice}". Use bass, tenor, alto or soprano.`);
      voices.push(v);
    }
    all.push(...group.words.map(normalize));
  });
  if (new Set(all).size !== 16) throw new Error("Puzzle words must be unique.");
  if (voices.length && (voices.length !== 4 || new Set(voices).size !== 4)) {
    throw new Error("If groups name their voices, each of the four voices must be used once.");
  }
  if (data.backgroundImage !== undefined && typeof data.backgroundImage !== "string") {
    throw new Error("A puzzle's backgroundImage, if present, must be a text string.");
  }
}

// ---------------------------------------------------------------- game

function resetGame() {
  selected.clear();
  solvedGroupNames.clear();
  tuttiSolvedNames.clear();
  tuttiPick = null;
  tuttiBravo = false;
  mode = "start";
  mistakesRemaining = puzzle.maxMistakes || MAX_MISTAKES;
  words = shuffleArray(puzzle.groups.flatMap(group => group.words));
  el.title.textContent = puzzle.title || "Quartets of You";
  el.subtitle.textContent = puzzle.subtitle || "Find four quartets of four related words.";
  el.pageBg.style.backgroundImage = puzzle.backgroundImage ? `url("${puzzle.backgroundImage}")` : "none";
  el.message.textContent = "";
  el.list.classList.add("hidden");
  el.compose.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.end.classList.add("hidden");
  const back = el.standardControls.querySelector("a");
  back.textContent = playingFromCompose ? "Back to Compose" : "Repertoire";
  back.href = playingFromCompose ? "index.html?compose" : "index.html";
  render();
}

function render() {
  el.startPanel.classList.toggle("hidden", mode !== "start");
  el.tuttiIntro.classList.toggle("hidden", mode !== "tutti");
  el.standardControls.classList.toggle("hidden", mode === "tutti");
  el.tuttiControls.classList.toggle("hidden", mode !== "tutti");
  renderSolvedGroups();
  if (mode === "tutti") renderTuttiGrid(); else renderGrid();
  renderStatus();
}

function buildGroupCard(group) {
  const voice = voiceOf(group);
  const card = document.createElement("div");
  card.className = `solved-card voice-${voice}`;

  const label = document.createElement("span");
  label.className = "voice-label";
  label.append(voiceBadge(voice), document.createTextNode(VOICE_LABELS[voice]));

  const name = document.createElement("span");
  name.className = "solved-name";
  name.textContent = group.name;

  const small = document.createElement("small");
  small.textContent = group.words.join(", ");
  card.append(label, name, small);

  if (group.details) attachDetails(card, group.details);
  return card;
}

function attachDetails(node, details) {
  node.classList.add("has-details");
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  const hint = document.createElement("span");
  hint.className = "details-hint";
  hint.textContent = "Tap for the backstory";
  node.appendChild(hint);
  const open = () => showDetailsPopup(details);
  node.addEventListener("click", open);
  node.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
}

function showDetailsPopup(text, onClose) {
  detailsCloseCallback = onClose || null;
  el.detailsText.textContent = text;
  el.modal.classList.remove("hidden");
  el.detailsClose.focus();
}

function closeDetailsPopup() {
  el.modal.classList.add("hidden");
  const callback = detailsCloseCallback;
  detailsCloseCallback = null;
  if (callback) callback();
}

function openHelpModal() {
  el.helpModal.classList.remove("hidden");
  el.helpClose.focus();
}

function closeHelpModal() {
  el.helpModal.classList.add("hidden");
}

function groupByName(name) {
  return puzzle.groups.find(group => group.name === name);
}

function renderSolvedGroups() {
  el.solved.innerHTML = "";
  [...solvedGroupNames].forEach(name => el.solved.appendChild(buildGroupCard(groupByName(name))));
}

function unsolvedWords() {
  const solvedWords = new Set(
    puzzle.groups
      .filter(group => solvedGroupNames.has(group.name))
      .flatMap(group => group.words.map(normalize))
  );
  return words.filter(word => !solvedWords.has(normalize(word)));
}

function renderGrid() {
  el.grid.className = "grid";
  el.grid.innerHTML = "";
  unsolvedWords().forEach(word => {
    const button = document.createElement("button");
    button.className = "tile" + (selected.has(word) ? " selected" : "");
    button.textContent = word;
    button.type = "button";
    button.setAttribute("aria-pressed", selected.has(word) ? "true" : "false");
    button.addEventListener("click", () => toggleWord(word));
    el.grid.appendChild(button);
  });
}

// In Tutti the 16 words are laid out as four rows of four. The row a word
// sits in is its guess; tapping two tiles swaps them.
function renderTuttiGrid() {
  el.grid.className = "tutti-grid";
  el.grid.innerHTML = "";
  for (let r = 0; r < 4; r++) {
    const row = document.createElement("div");
    row.className = "tutti-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Row ${r + 1}`);
    for (let c = 0; c < 4; c++) {
      const i = r * 4 + c;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile" + (tuttiPick === i ? " selected" : "");
      button.textContent = words[i];
      button.setAttribute("aria-pressed", tuttiPick === i ? "true" : "false");
      button.addEventListener("click", () => tuttiTap(i));
      row.appendChild(button);
    }
    el.grid.appendChild(row);
  }
}

function renderStatus() {
  const max = puzzle.maxMistakes || MAX_MISTAKES;
  el.mistakes.innerHTML = "";
  if (mode === "tutti") return;
  el.mistakes.setAttribute("aria-label", `Bum notes left: ${mistakesRemaining} of ${max}`);
  const label = document.createElement("span");
  label.textContent = "Bum notes left: ";
  label.setAttribute("aria-hidden", "true");
  el.mistakes.appendChild(label);
  for (let i = 0; i < max; i++) {
    const note = document.createElement("span");
    note.className = "note" + (i < mistakesRemaining ? "" : " spent");
    note.setAttribute("aria-hidden", "true");
    note.textContent = "♪";
    el.mistakes.appendChild(note);
  }
  el.submit.disabled = selected.size !== 4;
}

function beginStandard() {
  if (mode === "start") mode = "standard";
}

function toggleWord(word) {
  beginStandard();
  el.message.textContent = "";
  if (selected.has(word)) {
    selected.delete(word);
  } else if (selected.size < 4) {
    selected.add(word);
  }
  render();
}

function clearSelection() {
  beginStandard();
  selected.clear();
  el.message.textContent = "";
  render();
}

function submitSelection() {
  if (selected.size !== 4 || mode === "over") return;
  beginStandard();
  const choice = groupKey([...selected]);
  const match = puzzle.groups.find(group =>
    groupKey(group.words) === choice && !solvedGroupNames.has(group.name));

  if (match) {
    solvedGroupNames.add(match.name);
    selected.clear();
    el.message.textContent = "";
    render();
    afterSolve(match);
  } else {
    mistakesRemaining -= 1;
    const oneAway = isOneAway(selected);
    el.message.textContent = mistakesRemaining > 0
      ? (oneAway ? "One note off…" : "Bum note. Try another quartet.")
      : "Four bum notes. That's the end of the performance.";
    // Leave the guess selected so the player can see what they just tried.
    render();
    if (mistakesRemaining <= 0) {
      mode = "over";
      setTimeout(() => endGame(false), REVEAL_DELAY_MS);
    }
  }
}

function afterSolve(group) {
  const justWon = solvedGroupNames.size === 4;
  if (justWon) mode = "over";
  if (group && group.details) {
    showDetailsPopup(group.details, justWon ? () => endGame(true) : null);
  } else if (justWon) {
    setTimeout(() => endGame(true), REVEAL_DELAY_MS);
  }
}

function isOneAway(selectedWords) {
  const chosen = new Set([...selectedWords].map(normalize));
  return puzzle.groups.some(group => {
    if (solvedGroupNames.has(group.name)) return false;
    return group.words.filter(word => chosen.has(normalize(word))).length === 3;
  });
}

// ---------------------------------------------------------------- Tutti

function startTutti() {
  if (mode !== "start") return;
  mode = "tutti";
  selected.clear();
  tuttiPick = null;
  el.message.textContent = "";
  render();
}

function skipTutti() {
  mode = "standard";
  tuttiPick = null;
  render();
}

function tuttiTap(i) {
  if (tuttiPick === null) {
    tuttiPick = i;
  } else if (tuttiPick === i) {
    tuttiPick = null;
  } else {
    [words[tuttiPick], words[i]] = [words[i], words[tuttiPick]];
    tuttiPick = null;
  }
  render();
  // Keep keyboard focus on the tile the player just used.
  const tiles = el.grid.querySelectorAll(".tile");
  if (tiles[i]) tiles[i].focus();
}

function submitTutti() {
  if (mode !== "tutti") return;
  const correct = [];
  for (let r = 0; r < 4; r++) {
    const key = groupKey(words.slice(r * 4, r * 4 + 4));
    const group = puzzle.groups.find(g => groupKey(g.words) === key);
    if (group) correct.push(group);
  }
  correct.forEach(group => {
    solvedGroupNames.add(group.name);
    tuttiSolvedNames.add(group.name);
  });
  tuttiPick = null;

  if (correct.length === 4) {
    tuttiBravo = true;
    mode = "over";
    render();
    showBravo();
    return;
  }

  mode = "standard";
  el.message.textContent = correct.length === 0
    ? "No rows were quite right. Carry on, one quartet at a time."
    : `${correct.length} ${correct.length === 1 ? "row was" : "rows were"} right and carry over. Find the rest.`;
  render();
}

function showBravo() {
  const notes = el.bravo.querySelector(".bravo-notes");
  notes.innerHTML = "";
  const glyphs = ["♪", "♫", "♩", "♬"];
  for (let i = 0; i < 28; i++) {
    const n = document.createElement("span");
    n.textContent = glyphs[i % glyphs.length];
    n.className = `voice-text-${VOICES[i % 4]}`;
    n.style.left = `${Math.random() * 100}%`;
    n.style.animationDelay = `${Math.random() * 1.6}s`;
    n.style.fontSize = `${1.4 + Math.random() * 1.8}rem`;
    notes.appendChild(n);
  }
  el.bravo.classList.remove("hidden");
  el.bravoClose.focus();
}

function closeBravo() {
  el.bravo.classList.add("hidden");
  endGame(true);
}

// ---------------------------------------------------------------- results

function endGame(won) {
  mode = "over";
  const performed = new Set(solvedGroupNames);
  if (!won) {
    // Append the groups the player never found, in voice order, after the
    // ones they did (which are already in the order they were solved).
    [...puzzle.groups]
      .sort((a, b) => VOICES.indexOf(voiceOf(a)) - VOICES.indexOf(voiceOf(b)))
      .forEach(group => solvedGroupNames.add(group.name));
  }
  el.game.classList.add("hidden");
  el.end.classList.remove("hidden");
  el.endTitle.textContent = tuttiBravo ? "Bravo!" : (won ? "Standing ovation" : "The curtain falls");
  el.endMessage.textContent = won
    ? (puzzle.winMessage || "Every quartet found. Thanks for performing!")
    : "Four bum notes ended the performance. Here is the full program.";
  el.batonMark.classList.toggle("hidden", !tuttiBravo);

  el.endGroups.innerHTML = "";
  [...solvedGroupNames].forEach(name => {
    const group = groupByName(name);
    const voice = voiceOf(group);
    const li = document.createElement("li");
    li.className = `program-item voice-${voice}` + (performed.has(name) ? "" : " not-performed");

    const head = document.createElement("div");
    head.className = "program-head";
    const vname = document.createElement("span");
    vname.className = "program-voice";
    vname.append(voiceBadge(voice), document.createTextNode(VOICE_LABELS[voice]));
    const dots = document.createElement("span");
    dots.className = "program-dots";
    dots.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "program-title";
    title.textContent = group.name;
    head.append(vname, dots, title);

    const wordsLine = document.createElement("div");
    wordsLine.className = "program-words";
    wordsLine.textContent = group.words.join(" · ");

    li.append(head, wordsLine);
    if ((tuttiSolvedNames.has(name) && !tuttiBravo) || !performed.has(name)) {
      const note = document.createElement("div");
      note.className = "program-note";
      note.textContent = performed.has(name) ? "Performed in Tutti" : "Not performed";
      li.appendChild(note);
    }
    if (group.details) attachDetails(li, group.details);
    el.endGroups.appendChild(li);
  });
}

// ---------------------------------------------------------------- Compose

const DRAFT_KEY = "quartets-of-you:compose-draft";
const supportsFolderSave = typeof window.showDirectoryPicker === "function";
let puzzlesDirHandle = null;
let pendingOverwrite = null;
let idEditedByHand = false;

const c = {
  form: $("compose-form"),
  title: $("c-title"),
  id: $("c-id"),
  idPreview: $("c-id-preview"),
  subtitle: $("c-subtitle"),
  win: $("c-win"),
  groups: $("c-groups"),
  errors: $("compose-errors"),
  status: $("compose-status"),
  tryBtn: $("c-try-btn"),
  folderBtn: $("c-folder-btn"),
  saveBtn: $("c-save-btn"),
  saveNote: $("c-save-note")
};

function slugify(text) {
  return normalize(text)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildComposeGroups() {
  c.groups.innerHTML = "";
  VOICES.forEach((voice, gi) => {
    const fs = document.createElement("fieldset");
    fs.className = `compose-group voice-edge-${voice}`;
    fs.dataset.index = gi;
    fs.innerHTML = `
      <legend>Quartet ${gi + 1}</legend>
      <div class="field-row">
        <label class="field">
          <span>Category</span>
          <input type="text" class="g-name" maxlength="80" placeholder="What the four words share" />
        </label>
        <label class="field field-narrow">
          <span>Voice</span>
          <select class="g-voice">
            ${VOICES.map(v => `<option value="${v}">${VOICE_LABELS[v]}${v === "bass" ? " (easiest)" : v === "soprano" ? " (hardest)" : ""}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="word-inputs">
        ${[1, 2, 3, 4].map(n => `<label class="field"><span class="visually-hidden">Quartet ${gi + 1}, word ${n}</span><input type="text" class="g-word" maxlength="40" placeholder="Word ${n}" /></label>`).join("")}
      </div>
      <label class="field">
        <span>Backstory <small class="muted">(optional, shown when this quartet is solved)</small></span>
        <textarea class="g-details" rows="2" maxlength="600"></textarea>
      </label>`;
    fs.querySelector(".g-voice").value = voice;
    fs.querySelector(".g-voice").addEventListener("change", e => {
      fs.className = `compose-group voice-edge-${e.target.value}`;
    });
    c.groups.appendChild(fs);
  });
}

function readDraft() {
  const groups = [...c.groups.querySelectorAll(".compose-group")].map(fs => ({
    name: fs.querySelector(".g-name").value.trim(),
    voice: fs.querySelector(".g-voice").value,
    words: [...fs.querySelectorAll(".g-word")].map(i => i.value.trim()),
    details: fs.querySelector(".g-details").value.trim()
  }));
  return {
    id: c.id.value.trim(),
    title: c.title.value.trim(),
    subtitle: c.subtitle.value.trim(),
    winMessage: c.win.value.trim(),
    groups
  };
}

function fillDraft(d) {
  c.title.value = d.title || "";
  c.id.value = d.id || "";
  c.subtitle.value = d.subtitle || "";
  c.win.value = d.winMessage || "";
  idEditedByHand = !!d.id && d.id !== slugify(d.title || "");
  const sets = c.groups.querySelectorAll(".compose-group");
  (d.groups || []).forEach((g, gi) => {
    const fs = sets[gi];
    if (!fs) return;
    fs.querySelector(".g-name").value = g.name || "";
    if (VOICES.includes(g.voice)) {
      fs.querySelector(".g-voice").value = g.voice;
      fs.className = `compose-group voice-edge-${g.voice}`;
    }
    fs.querySelectorAll(".g-word").forEach((input, wi) => { input.value = (g.words || [])[wi] || ""; });
    fs.querySelector(".g-details").value = g.details || "";
  });
}

function saveDraftLocally() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(readDraft())); } catch (_) { /* storage unavailable */ }
}

function loadDraftLocally() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// Checks a draft and marks the offending inputs. Returns a list of problems.
function checkDraft(d) {
  const errors = [];
  c.form.querySelectorAll("[aria-invalid]").forEach(n => n.removeAttribute("aria-invalid"));
  const flag = node => node.setAttribute("aria-invalid", "true");

  if (!d.title) { errors.push("Give the puzzle a title."); flag(c.title); }
  if (!d.id) { errors.push("Give the puzzle a file name."); flag(c.id); }
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id)) {
    errors.push("The file name can use only lowercase letters, numbers and single dashes.");
    flag(c.id);
  }

  const sets = [...c.groups.querySelectorAll(".compose-group")];
  d.groups.forEach((g, gi) => {
    const fs = sets[gi];
    const label = `Quartet ${gi + 1}`;
    if (!g.name) { errors.push(`${label} needs a category name.`); flag(fs.querySelector(".g-name")); }
    const blanks = g.words.filter(w => !w).length;
    if (blanks) {
      errors.push(`${label} needs ${blanks === 4 ? "four words" : `${blanks} more word${blanks === 1 ? "" : "s"}`}.`);
      fs.querySelectorAll(".g-word").forEach(i => { if (!i.value.trim()) flag(i); });
    }
  });

  const voiceCounts = {};
  d.groups.forEach(g => { voiceCounts[g.voice] = (voiceCounts[g.voice] || 0) + 1; });
  const repeated = VOICES.filter(v => voiceCounts[v] > 1);
  const missing = VOICES.filter(v => !voiceCounts[v]);
  if (repeated.length) {
    errors.push(`Each voice is used once. ${repeated.map(v => VOICE_LABELS[v]).join(" and ")} ${repeated.length === 1 ? "is" : "are"} used twice; ${missing.map(v => VOICE_LABELS[v]).join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`);
    sets.forEach((fs, gi) => { if (voiceCounts[d.groups[gi].voice] > 1) flag(fs.querySelector(".g-voice")); });
  }

  const seen = new Map();
  d.groups.forEach((g, gi) => g.words.forEach((w, wi) => {
    if (!w) return;
    const k = normalize(w);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push([gi, wi, w]);
  }));
  seen.forEach(spots => {
    if (spots.length < 2) return;
    errors.push(`"${spots[0][2]}" appears ${spots.length} times. All sixteen words must be different.`);
    spots.forEach(([gi, wi]) => flag(sets[gi].querySelectorAll(".g-word")[wi]));
  });

  return errors;
}

function showErrors(errors) {
  c.errors.innerHTML = "";
  c.errors.classList.toggle("hidden", errors.length === 0);
  if (!errors.length) return;
  const p = document.createElement("p");
  p.textContent = "Not quite ready yet:";
  const ul = document.createElement("ul");
  errors.forEach(e => {
    const li = document.createElement("li");
    li.textContent = e;
    ul.appendChild(li);
  });
  c.errors.append(p, ul);
  c.errors.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Turns a checked draft into the puzzle file's contents, groups in voice order.
function draftToPuzzle(d) {
  const out = { title: d.title };
  if (d.subtitle) out.subtitle = d.subtitle;
  out.maxMistakes = MAX_MISTAKES;
  if (d.winMessage) out.winMessage = d.winMessage;
  out.groups = [...d.groups]
    .sort((a, b) => VOICES.indexOf(a.voice) - VOICES.indexOf(b.voice))
    .map(g => {
      const group = { name: g.name, voice: g.voice, words: g.words };
      if (g.details) group.details = g.details;
      return group;
    });
  return out;
}

function checkedPuzzle() {
  const d = readDraft();
  const errors = checkDraft(d);
  if (!errors.length) {
    try { validatePuzzle(draftToPuzzle(d)); } catch (e) { errors.push(e.message); }
  }
  showErrors(errors);
  return errors.length ? null : { id: d.id, data: draftToPuzzle(d) };
}

function setStatus(nodes, kind = "ok") {
  c.status.innerHTML = "";
  c.status.className = `compose-status ${kind}`;
  c.status.append(...nodes);
}

function text(tag, content, className) {
  const n = document.createElement(tag);
  n.textContent = content;
  if (className) n.className = className;
  return n;
}

function showSavedStatus(id, title, how) {
  const line = `{ id: "${id}", title: ${JSON.stringify(title)} }`;
  const code = text("code", line, "copy-line");
  const copy = text("button", "Copy", "quiet-btn small-btn");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(line); copy.textContent = "Copied"; }
    catch (_) { copy.textContent = "Select and copy"; }
  });
  const row = document.createElement("div");
  row.className = "copy-row";
  row.append(code, copy);
  setStatus([
    text("p", how),
    text("p", "To list it in the Repertoire, add this line to the PUZZLES list at the top of script.js:"),
    row,
    text("p", `It already plays at index.html?puzzle=${id} when the game is served from this folder.`, "muted small")
  ]);
}

// ---- Saving: File System Access API on Chrome and Edge, download elsewhere.

const HANDLE_DB = "quartets-of-you";
const HANDLE_STORE = "handles";

function idb(action, value) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return resolve(null);
    const open = indexedDB.open(HANDLE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDLE_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(HANDLE_STORE, action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore(HANDLE_STORE);
      const req = action === "get" ? store.get("puzzlesDir") : store.put(value, "puzzlesDir");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    };
  });
}

function updateFolderNote() {
  if (!supportsFolderSave) {
    c.saveNote.textContent = "Saving downloads the puzzle file. Move it into the game's puzzles folder.";
    return;
  }
  c.folderBtn.classList.remove("hidden");
  c.folderBtn.textContent = puzzlesDirHandle ? "Change puzzles folder" : "Choose puzzles folder";
  c.saveNote.textContent = puzzlesDirHandle
    ? `Saving into the folder "${puzzlesDirHandle.name}".`
    : "The first time you save, choose the game's puzzles folder. The game remembers it after that.";
}

async function choosePuzzlesFolder() {
  try {
    const handle = await window.showDirectoryPicker({ id: "quartets-puzzles", mode: "readwrite" });
    puzzlesDirHandle = handle;
    pendingOverwrite = null;
    try { await idb("put", handle); } catch (_) { /* remembering is a convenience */ }
    updateFolderNote();
    if (handle.name !== "puzzles") {
      setStatus([text("p", `You picked a folder named "${handle.name}". Puzzles normally go in the folder named "puzzles" inside the game.`)], "warn");
    }
    return handle;
  } catch (e) {
    if (e.name !== "AbortError") setStatus([text("p", `Couldn't open that folder: ${e.message}`)], "warn");
    return null;
  }
}

async function ensureWritable(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

async function savePuzzle() {
  const result = checkedPuzzle();
  if (!result) return;
  const { id, data } = result;
  const filename = `${id}.json`;
  const json = JSON.stringify(data, null, 2) + "\n";

  if (!supportsFolderSave) {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showSavedStatus(id, data.title, `Downloaded ${filename}. Move it into the game's puzzles folder.`);
    return;
  }

  try {
    const dir = puzzlesDirHandle || await choosePuzzlesFolder();
    if (!dir) return;
    if (!(await ensureWritable(dir))) {
      setStatus([text("p", "The browser didn't allow saving to that folder. Try Save again, or choose the folder again.")], "warn");
      return;
    }
    let exists = false;
    try { await dir.getFileHandle(filename); exists = true; } catch (_) { exists = false; }
    if (exists && pendingOverwrite !== filename) {
      pendingOverwrite = filename;
      setStatus([text("p", `"${filename}" already exists in ${dir.name}. Click Save puzzle again to replace it, or change the file name.`)], "warn");
      c.saveBtn.textContent = "Replace file";
      return;
    }
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    pendingOverwrite = null;
    c.saveBtn.textContent = "Save puzzle";
    showSavedStatus(id, data.title, `Saved ${filename} in ${dir.name}.`);
  } catch (e) {
    setStatus([text("p", `Saving failed: ${e.message}`)], "warn");
  }
}

function showCompose() {
  el.title.textContent = "Compose";
  el.subtitle.textContent = "Write a puzzle of your own: for a wedding, a reunion, a classroom or a family night.";
  el.list.classList.add("hidden");
  el.game.classList.add("hidden");
  el.end.classList.add("hidden");
  el.compose.classList.remove("hidden");
  buildComposeGroups();
  const draft = loadDraftLocally();
  if (draft) fillDraft(draft);
  c.idPreview.textContent = `${c.id.value || "puzzle"}.json`;

  c.title.addEventListener("input", () => {
    if (!idEditedByHand) c.id.value = slugify(c.title.value);
  });
  c.id.addEventListener("input", () => {
    idEditedByHand = c.id.value.trim() !== "";
  });
  c.form.addEventListener("input", () => {
    c.idPreview.textContent = `${c.id.value || "puzzle"}.json`;
    if (pendingOverwrite) { pendingOverwrite = null; c.saveBtn.textContent = "Save puzzle"; }
    saveDraftLocally();
  });
  c.form.addEventListener("submit", e => { e.preventDefault(); savePuzzle(); });
  c.folderBtn.addEventListener("click", choosePuzzlesFolder);
  c.tryBtn.addEventListener("click", () => {
    const result = checkedPuzzle();
    if (!result) return;
    saveDraftLocally();
    puzzle = result.data;
    playingFromCompose = true;
    resetGame();
    window.scrollTo(0, 0);
  });

  if (supportsFolderSave) {
    idb("get").then(h => { puzzlesDirHandle = h; updateFolderNote(); }).catch(() => updateFolderNote());
  }
  updateFolderNote();
}

// ---------------------------------------------------------------- wiring

el.startStandard.addEventListener("click", () => { beginStandard(); render(); });
el.startTutti.addEventListener("click", startTutti);
el.tuttiShuffle.addEventListener("click", () => { words = shuffleArray(words); tuttiPick = null; render(); });
el.tuttiSkip.addEventListener("click", skipTutti);
el.tuttiSubmit.addEventListener("click", submitTutti);
el.bravoClose.addEventListener("click", closeBravo);

el.shuffle.addEventListener("click", () => {
  beginStandard();
  words = shuffleArray(words);
  el.message.textContent = "";
  render();
});
el.clear.addEventListener("click", clearSelection);
el.submit.addEventListener("click", submitSelection);
el.playAgain.addEventListener("click", resetGame);

el.detailsClose.addEventListener("click", closeDetailsPopup);
el.modal.addEventListener("click", event => {
  if (event.target.classList.contains("modal-backdrop")) closeDetailsPopup();
});

el.helpBtn.addEventListener("click", openHelpModal);
el.gameHelpBtn.addEventListener("click", openHelpModal);
el.helpClose.addEventListener("click", closeHelpModal);
el.helpModal.addEventListener("click", event => {
  if (event.target.classList.contains("modal-backdrop")) closeHelpModal();
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!el.modal.classList.contains("hidden")) closeDetailsPopup();
  if (!el.helpModal.classList.contains("hidden")) closeHelpModal();
});

// About: a small dialog with the copyright and licenses. It only opens and
// closes; it never touches game state, timers or storage.
const aboutDialog = $("about-dialog");
$("about-btn").addEventListener("click", () => aboutDialog.showModal());
$("about-close-btn").addEventListener("click", () => aboutDialog.close());
aboutDialog.addEventListener("click", event => {
  // The content fills the dialog box, so a click on the dialog itself is the backdrop.
  if (event.target === aboutDialog) aboutDialog.close();
});

if (qs.has("compose")) {
  showCompose();
} else if (!puzzleId) {
  showPuzzleList();
} else {
  loadPuzzle(puzzleId).catch(error => {
    console.error(error);
    el.title.textContent = "Puzzle unavailable";
    el.subtitle.textContent = `${error.message} Check the puzzle name in the address, or pick one from the Repertoire.`;
    el.list.classList.remove("hidden");
    const keepTitle = el.title.textContent, keepSub = el.subtitle.textContent;
    showPuzzleList();
    el.title.textContent = keepTitle;
    el.subtitle.textContent = keepSub;
  });
}

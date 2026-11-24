// Quartets of You: all app logic. No modules, no build step.
//
// Routing is driven by the query string:
//   index.html                       -> the Repertoire (the built-in puzzles)
//   index.html?puzzle=<id>           -> fetches puzzles/<id>.json and plays it
//   index.html?pack=<url>            -> fetches a puzzle pack from anywhere and lists its puzzles
//   index.html?pack=<url>&play=<n>   -> plays puzzle n (counting from 1) of that pack
//   index.html?compose               -> "Make your own puzzles" help page
//   index.html?compose=form          -> the Compose form
//
// The file format is described in docs/PUZZLE_FORMAT.md and
// schema/quartets-pack.schema.json. checkPack() below enforces the same rules.

// The Repertoire. Add a line here for each puzzle file in puzzles/.
const PUZZLES = [
  { id: "opening-night", title: "Opening Night" },
  { id: "practice-room", title: "Practice Room" }
];

// Voices, from easiest to hardest. A group's voice sets its color and label.
const VOICES = ["bass", "tenor", "alto", "soprano"];
const VOICE_LABELS = { bass: "Bass", tenor: "Tenor", alto: "Alto", soprano: "Soprano" };

const MAX_MISTAKES = 4;
const MAX_MISTAKES_LIMIT = 10;
const REVEAL_DELAY_MS = 900;

// The newest pack format this game understands.
const FORMAT_VERSION = 1;
const PACK_FETCH_TIMEOUT_MS = 15000;
const PACK_MAX_BYTES = 2 * 1024 * 1024;
const MAX_LISTED_ERRORS = 25;
const REPO_URL = "https://github.com/AReflectionOfYou/QuartetsOfYouGame";
const FORMAT_GUIDE_URL = `${REPO_URL}/blob/main/docs/PUZZLE_FORMAT.md`;
const FORMAT_GUIDE_RAW_URL = "https://raw.githubusercontent.com/AReflectionOfYou/QuartetsOfYouGame/main/docs/PUZZLE_FORMAT.md";

let puzzle = null;
let words = [];
let selected = new Set();
let solvedGroupNames = new Set();   // insertion order = order solved
let tuttiSolvedNames = new Set();
let mistakesRemaining = MAX_MISTAKES;
let mode = "start";                 // "start" | "tutti" | "standard" | "over"
let tuttiPick = null;               // index into words of the first tapped tile in Tutti
let tuttiBravo = false;
let backTo = { label: "Repertoire", href: "index.html" };  // where the game's back buttons go

const qs = new URLSearchParams(window.location.search);
const puzzleId = qs.get("puzzle");

const $ = id => document.getElementById(id);
const el = {
  title: $("puzzle-title"),
  subtitle: $("puzzle-subtitle"),
  packBar: $("pack-bar"),
  packBarTitle: $("pack-bar-title"),
  packBarByline: $("pack-bar-byline"),
  packWarning: $("pack-warning"),
  list: $("puzzle-list"),
  links: $("puzzle-links"),
  packError: $("pack-error"),
  packErrorTitle: $("pack-error-title"),
  packErrorMessage: $("pack-error-message"),
  packErrorDetails: $("pack-error-details"),
  packErrorHint: $("pack-error-hint"),
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
  gameBack: $("game-back"),
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
  endBack: $("end-back"),
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
  composeHelp: $("compose-help"),
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function quoted(value) {
  return isText(value) ? ` ("${value.trim().slice(0, 40)}")` : "";
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

function text(tag, content, className) {
  const n = document.createElement(tag);
  n.textContent = content;
  if (className) n.className = className;
  return n;
}

function link(href, content, className) {
  const a = text("a", content, className);
  a.href = href;
  return a;
}

async function copyText(value, button, idleLabel) {
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
  } catch (_) {
    button.textContent = "Select and copy";
    return false;
  }
  setTimeout(() => { button.textContent = idleLabel; }, 2000);
  return true;
}

// ---------------------------------------------------------------- links

// Keeps ":" and "/" readable in the share link; everything else is encoded.
function encodePackParam(url) {
  return encodeURIComponent(url).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
}

function packHref(url, n) {
  return `index.html?pack=${encodePackParam(url)}` + (n ? `&play=${n}` : "");
}

// The full address to share: this game's address plus ?pack=.
function shareLinkFor(url) {
  return `${window.location.origin}${window.location.pathname}?pack=${encodePackParam(url)}`;
}

// ---------------------------------------------------------------- Repertoire

// items: [{ href, title }]
function showPuzzleList(items, heading, subtitle) {
  el.title.textContent = heading || "Quartets of You";
  el.subtitle.textContent = subtitle !== undefined ? subtitle
    : "Sort sixteen words into four quartets, from Bass to Soprano. Pick a piece from the Repertoire, or compose your own.";
  el.list.classList.remove("hidden");
  el.pageBg.style.backgroundImage = "none";
  el.links.innerHTML = "";
  (items || PUZZLES.map(p => ({ href: `index.html?puzzle=${encodeURIComponent(p.id)}`, title: p.title })))
    .forEach(p => {
      const a = document.createElement("a");
      a.href = p.href;
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

// ---------------------------------------------------------------- validation
//
// checkPack() mirrors schema/quartets-pack.schema.json and adds the rules a
// schema can't express (unique words, unique quartet names). It never throws:
// it returns every problem it finds, worded for people, so a pack author (or
// an AI) can fix them all in one pass. Unknown extra fields are ignored.

const VOICE_LIST_TEXT = "bass, tenor, alto or soprano";

function checkGroup(group, where) {
  const errors = [];
  if (!isObject(group)) return [`${where} must be an object: { "name": ..., "words": [...] }.`];
  if (!("name" in group)) errors.push(`${where} is missing "name", the category the four words share.`);
  else if (!isText(group.name)) errors.push(`${where}: "name" must be non-empty text.`);
  if (!("words" in group)) errors.push(`${where} is missing "words", its list of four words.`);
  else if (!Array.isArray(group.words)) errors.push(`${where}: "words" must be a list of four words: ["...", "...", "...", "..."].`);
  else {
    if (group.words.length !== 4) {
      errors.push(`${where}: "words" has ${group.words.length} ${group.words.length === 1 ? "word" : "words"}; it needs exactly 4.`);
    }
    group.words.forEach((w, wi) => {
      if (!isText(w)) errors.push(`${where}: word ${wi + 1} must be non-empty text.`);
    });
  }
  if (group.voice !== undefined) {
    if (typeof group.voice !== "string" || !VOICES.includes(group.voice.toLowerCase())) {
      errors.push(`${where}: "voice" is ${JSON.stringify(group.voice)}; use ${VOICE_LIST_TEXT}.`);
    }
  }
  if (group.details !== undefined && typeof group.details !== "string") {
    errors.push(`${where}: "details" must be text.`);
  }
  return errors;
}

function checkPuzzle(p, where) {
  if (!isObject(p)) return [`${where} must be an object: { "title": ..., "groups": [...] }.`];
  const errors = [];
  ["title", "subtitle", "winMessage", "backgroundImage"].forEach(key => {
    if (p[key] !== undefined && typeof p[key] !== "string") errors.push(`${where}: "${key}" must be text.`);
  });
  if (p.maxMistakes !== undefined &&
      !(Number.isInteger(p.maxMistakes) && p.maxMistakes >= 1 && p.maxMistakes <= MAX_MISTAKES_LIMIT)) {
    errors.push(`${where}: "maxMistakes" must be a whole number from 1 to ${MAX_MISTAKES_LIMIT}.`);
  }
  if (!("groups" in p)) return [...errors, `${where} is missing "groups", its list of four quartets.`];
  if (!Array.isArray(p.groups)) return [...errors, `${where}: "groups" must be a list of four quartets.`];
  if (p.groups.length !== 4) {
    errors.push(`${where}: "groups" has ${p.groups.length} ${p.groups.length === 1 ? "quartet" : "quartets"}; it needs exactly 4.`);
  }

  const groupWhere = (g, gi) => `${where}, quartet ${gi + 1}${isObject(g) ? quoted(g.name) : ""}`;
  p.groups.forEach((g, gi) => errors.push(...checkGroup(g, groupWhere(g, gi))));
  const groups = p.groups.filter(isObject);

  // Voices: all or none, each used once.
  const named = groups.filter(g => g.voice !== undefined);
  if (named.length && named.length !== p.groups.length) {
    errors.push(`${where}: some quartets name a "voice" and some don't. Give all four a voice (${VOICE_LIST_TEXT}, each once), or leave it out of all four.`);
  } else if (named.length) {
    const counts = {};
    named.forEach(g => {
      const v = String(g.voice).toLowerCase();
      if (VOICES.includes(v)) counts[v] = (counts[v] || 0) + 1;
    });
    const repeated = VOICES.filter(v => counts[v] > 1);
    if (repeated.length) {
      const missing = VOICES.filter(v => !counts[v]);
      errors.push(`${where}: each voice is used once. ${repeated.map(v => VOICE_LABELS[v]).join(" and ")} ${repeated.length === 1 ? "is" : "are"} used more than once` +
        (missing.length ? `; ${missing.map(v => VOICE_LABELS[v]).join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.` : "."));
    }
  }

  // Unique words across the whole puzzle, ignoring case and spaces.
  const seen = new Map();
  p.groups.forEach((g, gi) => {
    if (!isObject(g) || !Array.isArray(g.words)) return;
    g.words.forEach(w => {
      if (!isText(w)) return;
      const k = normalize(w);
      if (!seen.has(k)) seen.set(k, { word: w.trim(), quartets: [] });
      seen.get(k).quartets.push(gi + 1);
    });
  });
  seen.forEach(({ word, quartets }) => {
    if (quartets.length < 2) return;
    const whereList = new Set(quartets).size === 1 ? `twice in quartet ${quartets[0]}` : `in quartets ${quartets.join(" and ")}`;
    errors.push(`${where}: "${word}" appears ${whereList}. All sixteen words must be different (upper and lower case count as the same).`);
  });

  // Unique quartet names: the game tells quartets apart by name.
  const names = new Map();
  groups.forEach(g => {
    if (!isText(g.name)) return;
    const k = normalize(g.name);
    if (!names.has(k)) names.set(k, { name: g.name.trim(), count: 0 });
    names.get(k).count += 1;
  });
  names.forEach(({ name, count }) => {
    if (count > 1) errors.push(`${where}: ${count} quartets are named "${name}". Each quartet needs its own name.`);
  });
  return errors;
}

// Accepts a pack ({ puzzles: [...] }) or a single puzzle ({ groups: [...] }).
// Returns { pack, errors, warnings }. pack is null when the file can't be read
// as either shape; otherwise it is a normalized pack (always with "puzzles").
function checkPack(data) {
  const errors = [];
  const warnings = [];
  if (!isObject(data)) {
    return { pack: null, errors: ["The file must hold one JSON object, starting with { and ending with }."], warnings };
  }
  let version = 1;
  if (data.formatVersion !== undefined) {
    if (!Number.isInteger(data.formatVersion) || data.formatVersion < 1) {
      errors.push(`"formatVersion" must be a whole number such as 1.`);
    } else {
      version = data.formatVersion;
      if (version > FORMAT_VERSION) {
        warnings.push(`This pack uses format version ${version}, and this game understands version ${FORMAT_VERSION}. It may not play exactly as its author intended.`);
      }
    }
  }
  const hasPuzzles = "puzzles" in data;
  const hasGroups = "groups" in data;
  if (hasPuzzles && hasGroups) {
    errors.push(`The file has both "puzzles" and "groups" at the top. A pack lists its puzzles under "puzzles"; a single puzzle has "groups". Use one or the other.`);
    return { pack: null, errors, warnings };
  }
  if (!hasPuzzles && !hasGroups) {
    errors.push(`The file needs a "puzzles" list (for a pack) or a "groups" list (for a single puzzle).`);
    return { pack: null, errors, warnings };
  }

  let pack;
  if (hasPuzzles) {
    ["title", "author", "description", "license"].forEach(key => {
      if (data[key] !== undefined && typeof data[key] !== "string") errors.push(`The pack's "${key}" must be text.`);
    });
    if (!Array.isArray(data.puzzles)) {
      errors.push(`"puzzles" must be a list of puzzles: [ { ... }, { ... } ].`);
      return { pack: null, errors, warnings };
    }
    if (!data.puzzles.length) errors.push(`"puzzles" is empty. A pack needs at least one puzzle.`);
    data.puzzles.forEach((p, i) => {
      errors.push(...checkPuzzle(p, `Puzzle ${i + 1}${isObject(p) ? quoted(p.title) : ""}`));
    });
    pack = { ...data, formatVersion: version };
  } else {
    errors.push(...checkPuzzle(data, `The puzzle${quoted(data.title)}`));
    pack = { formatVersion: version, title: data.title, puzzles: [data] };
  }
  return { pack, errors, warnings };
}

// For the built-in puzzles: throws the first problem, as before.
function validatePuzzle(data) {
  const errors = checkPuzzle(data, "This puzzle");
  if (errors.length) throw new Error(errors[0]);
}

function packTitle(pack) {
  if (isText(pack.title)) return pack.title.trim();
  if (pack.puzzles.length === 1 && isText(pack.puzzles[0].title)) return pack.puzzles[0].title.trim();
  return "Untitled pack";
}

function puzzleTitle(p, i) {
  return isText(p.title) ? p.title.trim() : `Puzzle ${i + 1}`;
}

// ---------------------------------------------------------------- loading packs

class PackError extends Error {
  constructor(kind, message, details = []) {
    super(message);
    this.kind = kind;        // address | mixed | timeout | unreachable | blocked | http | toolarge | notjson | invalid
    this.details = details;
  }
}

// Turns what someone typed or pasted into an absolute http(s) address.
// Relative addresses (like docs/example-pack.json) resolve against the game.
function resolvePackUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new PackError("address", "There's no pack address to load.");
  let url;
  try { url = new URL(value, window.location.href); } catch (_) {
    throw new PackError("address", `"${value}" isn't a web address. It should look like https://example.org/my-pack.json.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PackError("address", `The pack address must start with https:// (it starts with ${url.protocol}//).`);
  }
  if (window.location.protocol === "https:" && url.protocol === "http:") {
    throw new PackError("mixed", "This game is served over https, so browsers won't let it load a pack from a plain http:// address. Use the pack's https:// address.");
  }
  return url.href;
}

// Advice for addresses that point at a web page about the file rather than the file itself.
function addressHint(url) {
  let u;
  try { u = new URL(url); } catch (_) { return ""; }
  if (u.hostname === "github.com" && u.pathname.includes("/blob/")) {
    return "That address is GitHub's page about the file. Use the file itself: open it on GitHub, press Raw, and use that address (it starts with https://raw.githubusercontent.com/).";
  }
  if (u.hostname === "gist.github.com" && !u.pathname.includes("/raw")) {
    return "That address is the gist's web page. Press Raw on the gist and use that address instead.";
  }
  if (u.hostname === "www.dropbox.com" || u.hostname === "drive.google.com") {
    return "File-sharing pages usually don't allow other sites to read the file directly. GitHub Pages or a gist's Raw link work reliably.";
  }
  return "";
}

const CORS_HINT = "The site hosting a pack must allow cross-origin access, so other sites (like this game) can read it. GitHub Pages and a GitHub gist's Raw link both do.";

// Turns JSON.parse's message into one with a line and column when it can.
function jsonErrorMessage(error, source) {
  const m = /position (\d+)/.exec(error.message);
  if (!m) return error.message;
  const pos = Number(m[1]);
  const before = source.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return `${error.message.replace(/\s*\(line \d+ column \d+\)/, "")} (line ${line}, column ${col})`;
}

// Parses pack text. Forgives the extras an AI assistant tends to add:
// a ```json code fence, or a sentence before or after the JSON.
function parsePackText(source) {
  let body = String(source).replace(/^﻿/, "").trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(body);
  if (fence) body = fence[1].trim();
  if (/^</.test(body)) {
    throw new PackError("notjson", "This looks like a web page, not a JSON pack file.");
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    const first = body.indexOf("{"), last = body.lastIndexOf("}");
    if (first > 0 || (last >= 0 && last < body.length - 1)) {
      try { return JSON.parse(body.slice(first, last + 1)); } catch (_) { /* report the original error */ }
    }
    throw new PackError("notjson", `This isn't valid JSON: ${jsonErrorMessage(error, body)}.`);
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PACK_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetches and parses a pack. Throws a PackError that says what went wrong.
async function fetchPackData(rawUrl) {
  const url = resolvePackUrl(rawUrl);
  let response;
  try {
    response = await fetchWithTimeout(url, { mode: "cors", credentials: "omit", cache: "no-cache" });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new PackError("timeout", `The pack's host took more than ${PACK_FETCH_TIMEOUT_MS / 1000} seconds to answer.`);
    }
    // A CORS refusal and a dead address look the same to the page. An opaque
    // (no-cors) request tells them apart: it succeeds if the host answered at all.
    let reachable = false;
    try {
      await fetchWithTimeout(url, { mode: "no-cors", credentials: "omit", cache: "no-cache" });
      reachable = true;
    } catch (_) { reachable = false; }
    if (reachable) {
      throw new PackError("blocked", "The pack's host answered, but it doesn't allow other sites to read the file (it blocks cross-origin access).");
    }
    throw new PackError("unreachable", "The pack couldn't be reached. The address may be mistyped, the site may be down, or you may be offline.");
  }
  if (!response.ok) {
    const what = response.status === 404 ? "there's no file at that address (404 Not Found)"
      : `it answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new PackError("http", `The pack's host was reached, but ${what}.`);
  }
  const body = await response.text();
  if (body.length > PACK_MAX_BYTES) {
    throw new PackError("toolarge", `The file is ${Math.round(body.length / 1024)} KB. Packs can be up to ${PACK_MAX_BYTES / 1024 / 1024} MB.`);
  }
  return { url: response.url || url, data: parsePackText(body) };
}

// Fetches, parses and validates. Resolves to { url, pack, warnings }.
async function loadPack(rawUrl) {
  const { url, data } = await fetchPackData(rawUrl);
  const { pack, errors, warnings } = checkPack(data);
  if (errors.length) {
    const versionNote = warnings.length ? ` ${warnings[0]}` : "";
    throw new PackError("invalid", `The file was found, but it isn't a valid Quartets of You pack.${versionNote}`, errors);
  }
  return { url, pack: resolveImages(pack, url), warnings };
}

// Background images: relative paths are relative to the pack file. Only web
// and inline image addresses are kept.
function safeImageUrl(value, base) {
  if (!isText(value)) return "";
  try {
    const u = new URL(value.trim(), base || window.location.href);
    if (u.protocol === "https:" || u.protocol === "http:") return u.href;
    if (u.protocol === "data:" && /^data:image\//i.test(u.href)) return u.href;
  } catch (_) { /* not an address */ }
  return "";
}

function resolveImages(pack, base) {
  return {
    ...pack,
    puzzles: pack.puzzles.map(p => p.backgroundImage === undefined ? p
      : { ...p, backgroundImage: safeImageUrl(p.backgroundImage, base) })
  };
}

function showPackError(error, { title, defaultLabel } = {}) {
  el.list.classList.add("hidden");
  el.game.classList.add("hidden");
  el.title.textContent = title || "Puzzle pack unavailable";
  el.subtitle.textContent = "";
  el.packErrorTitle.textContent = error.kind === "invalid" ? "This pack has a few problems" : "This pack didn't load";
  el.packErrorMessage.textContent = error.message;
  el.packErrorDetails.innerHTML = "";
  const details = error.details || [];
  details.slice(0, MAX_LISTED_ERRORS).forEach(d => el.packErrorDetails.appendChild(text("li", d)));
  if (details.length > MAX_LISTED_ERRORS) {
    el.packErrorDetails.appendChild(text("li", `…and ${details.length - MAX_LISTED_ERRORS} more.`));
  }
  el.packErrorDetails.classList.toggle("hidden", !details.length);
  const hints = [];
  if (["blocked", "unreachable", "timeout"].includes(error.kind)) hints.push(CORS_HINT);
  if (error.url) { const h = addressHint(error.url); if (h) hints.push(h); }
  if (error.kind === "invalid") hints.push("Whoever made the pack can open it in Compose to see and fix these problems.");
  el.packErrorHint.textContent = hints.join(" ");
  el.packErrorHint.classList.toggle("hidden", !hints.length);
  const button = el.packError.querySelector(".button-link");
  if (defaultLabel) button.textContent = defaultLabel;
  el.packError.classList.remove("hidden");
}

function showPackBar(loaded) {
  const { pack, warnings } = loaded;
  el.packBarTitle.textContent = packTitle(pack);
  const by = [isText(pack.author) ? `by ${pack.author.trim()}` : "", isText(pack.license) ? pack.license.trim() : ""]
    .filter(Boolean).join(" · ");
  el.packBarByline.textContent = by ? ` ${by}` : "";
  el.packBar.classList.remove("hidden");
  el.packWarning.textContent = warnings.join(" ");
  el.packWarning.classList.toggle("hidden", !warnings.length);
}

function playPuzzle(data) {
  validatePuzzle(data);
  puzzle = data;
  resetGame();
}

// ?pack=<url>[&play=<n>]
async function startPack(rawUrl, play) {
  el.title.textContent = "Loading puzzle pack…";
  el.subtitle.textContent = "";
  let loaded;
  try {
    loaded = await loadPack(rawUrl);
  } catch (error) {
    console.error(error);
    if (!error.url) { try { error.url = resolvePackUrl(rawUrl); } catch (_) { /* bad address */ } }
    showPackError(error);
    return;
  }
  const { url, pack } = loaded;
  showPackBar(loaded);
  const n = Number(play);
  if (play !== null && Number.isInteger(n) && n >= 1 && n <= pack.puzzles.length) {
    backTo = pack.puzzles.length === 1
      ? { label: "Play default puzzles", href: "index.html" }
      : { label: "Pack", href: packHref(url) };
    playPuzzle(pack.puzzles[n - 1]);
    return;
  }
  // A one-puzzle pack goes straight to its puzzle.
  if (pack.puzzles.length === 1) {
    backTo = { label: "Play default puzzles", href: "index.html" };
    playPuzzle(pack.puzzles[0]);
    return;
  }
  const items = pack.puzzles.map((p, i) => ({ href: packHref(url, i + 1), title: puzzleTitle(p, i) }));
  const count = `${pack.puzzles.length} puzzles`;
  showPuzzleList(items, packTitle(pack), isText(pack.description) ? pack.description.trim() : count);
  if (play !== null) {
    el.subtitle.textContent = `This pack has no puzzle number ${play}. Pick one below.`;
  }
}

// ?puzzle=<id>: one of the built-in puzzles.
async function startBuiltInPuzzle(id) {
  try {
    const response = await fetch(`puzzles/${encodeURIComponent(id)}.json`, { cache: "no-store" });
    if (!response.ok) throw new PackError("http", `There's no built-in puzzle named "${id}".`);
    const { pack, errors } = checkPack(parsePackText(await response.text()));
    if (errors.length) throw new PackError("invalid", `The built-in puzzle "${id}" has a few problems.`, errors);
    backTo = { label: "Repertoire", href: "index.html" };
    if (pack.puzzles.length === 1) { playPuzzle(pack.puzzles[0]); return; }
    showPuzzleList(pack.puzzles.map((p, i) => ({ href: packHref(`puzzles/${id}.json`, i + 1), title: puzzleTitle(p, i) })),
      packTitle(pack), isText(pack.description) ? pack.description : "");
  } catch (error) {
    console.error(error);
    showPackError(error, { title: "Puzzle unavailable", defaultLabel: "Back to the Repertoire" });
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
  const bg = safeImageUrl(puzzle.backgroundImage);
  el.pageBg.style.backgroundImage = bg ? `url(${JSON.stringify(bg)})` : "none";
  el.message.textContent = "";
  el.list.classList.add("hidden");
  el.compose.classList.add("hidden");
  el.packError.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.end.classList.add("hidden");
  el.gameBack.textContent = backTo.label;
  el.gameBack.href = backTo.href;
  el.endBack.textContent = backTo.label === "Repertoire" ? "Back to Repertoire" : backTo.label;
  el.endBack.href = backTo.href;
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


// ---------------------------------------------------------------- Make your own (Compose help page)

function showComposeHelp() {
  el.title.textContent = "Compose";
  el.subtitle.textContent = "Make puzzles of your own: for a wedding, a reunion, a classroom or a family night.";
  el.composeHelp.classList.remove("hidden");

  $("guide-link").href = FORMAT_GUIDE_URL;
  $("guide-link-ai").href = FORMAT_GUIDE_URL;

  const copyGuide = $("copy-guide-btn");
  copyGuide.addEventListener("click", async () => {
    copyGuide.textContent = "Fetching the guide…";
    let guide = "";
    for (const source of ["docs/PUZZLE_FORMAT.md", FORMAT_GUIDE_RAW_URL]) {
      try {
        const r = await fetch(source, { cache: "no-cache" });
        const body = r.ok ? await r.text() : "";
        if (body && !/^\s*</.test(body)) { guide = body; break; }
      } catch (_) { /* try the next source */ }
    }
    if (!guide) {
      copyGuide.textContent = "Couldn't fetch it. Open the guide instead.";
      return;
    }
    copyText(guide, copyGuide, "Copy the format guide");
  });

  $("share-form").addEventListener("submit", event => {
    event.preventDefault();
    testShareLink($("share-url").value);
  });
}

// Test-loads a pack and, if it plays, builds the link to share.
async function testShareLink(raw) {
  const out = $("share-result");
  const button = $("share-test-btn");
  out.className = "compose-status ok";
  out.replaceChildren(text("p", "Loading the pack to check it…"));
  button.disabled = true;
  try {
    const { url, pack, warnings } = await loadPack(raw);
    const count = pack.puzzles.length;
    const share = shareLinkFor(url);
    const code = text("code", share, "copy-line");
    const copy = text("button", "Copy link", "quiet-btn small-btn");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(share, copy, "Copy link"));
    const row = document.createElement("div");
    row.className = "copy-row";
    row.append(code, copy);
    const tryIt = link(packHref(url), "Try it", "button-link small-btn");
    tryIt.target = "_blank";
    tryIt.rel = "noopener";
    const nodes = [
      text("p", `It works: "${packTitle(pack)}", ${count} ${count === 1 ? "puzzle" : "puzzles"}. Share this link:`),
      row,
      tryIt
    ];
    if (warnings.length) nodes.splice(1, 0, text("p", warnings.join(" "), "muted small"));
    out.replaceChildren(...nodes);
  } catch (error) {
    out.className = "compose-status warn";
    const nodes = [text("p", error.message)];
    if (error.details && error.details.length) {
      const ul = document.createElement("ul");
      error.details.slice(0, MAX_LISTED_ERRORS).forEach(d => ul.appendChild(text("li", d)));
      if (error.details.length > MAX_LISTED_ERRORS) ul.appendChild(text("li", `…and ${error.details.length - MAX_LISTED_ERRORS} more.`));
      nodes.push(ul, text("p", "Open the pack in the Compose form to fix these.", "muted small"));
    }
    if (["blocked", "unreachable", "timeout"].includes(error.kind)) nodes.push(text("p", CORS_HINT, "muted small"));
    let url = "";
    try { url = resolvePackUrl(raw); } catch (_) { /* already reported */ }
    const hint = url && addressHint(url);
    if (hint) nodes.push(text("p", hint, "muted small"));
    out.replaceChildren(...nodes);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------- Compose form
//
// The form edits a pack: pack details plus one or more puzzles, one puzzle on
// screen at a time. Fields the form doesn't show (maxMistakes, backgroundImage,
// anything from a newer format) are kept in "extra" and written back on export.

const DRAFT_KEY = "quartets-of-you:compose-draft";
const BACKUP_KEY = "quartets-of-you:compose-draft-backup";
const KNOWN_PACK_KEYS = ["formatVersion", "title", "author", "description", "license", "puzzles"];
const KNOWN_PUZZLE_KEYS = ["formatVersion", "title", "subtitle", "winMessage", "groups"];
const KNOWN_GROUP_KEYS = ["name", "voice", "words", "details"];

let draft = null;
let fileNameEditedByHand = false;
let pendingRemove = false;
let undoDraft = null;

const c = {
  form: $("compose-form"),
  packTitle: $("c-pack-title"),
  author: $("c-author"),
  description: $("c-description"),
  license: $("c-license"),
  fileName: $("c-file"),
  filePreview: $("c-file-preview"),
  tabs: $("c-tabs"),
  addBtn: $("c-add-btn"),
  removeBtn: $("c-remove-btn"),
  puzzleLegend: $("c-puzzle-legend"),
  title: $("c-title"),
  subtitle: $("c-subtitle"),
  win: $("c-win"),
  groups: $("c-groups"),
  errors: $("compose-errors"),
  status: $("compose-status"),
  tryBtn: $("c-try-btn"),
  copyBtn: $("c-copy-btn"),
  exportOut: $("c-export-out"),
  openUrl: $("c-open-url"),
  openUrlBtn: $("c-open-url-btn"),
  openFile: $("c-open-file"),
  paste: $("c-paste"),
  pasteBtn: $("c-paste-btn"),
  openStatus: $("c-open-status")
};

function slugify(value) {
  return normalize(value)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pick(obj, omit) {
  const out = {};
  if (!isObject(obj)) return out;
  Object.keys(obj).forEach(k => { if (!omit.includes(k)) out[k] = obj[k]; });
  return out;
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function blankPuzzle() {
  return {
    title: "", subtitle: "", winMessage: "", extra: {},
    groups: VOICES.map(voice => ({ name: "", voice, words: ["", "", "", ""], details: "", extra: {} }))
  };
}

function blankDraft() {
  return { fileName: "", title: "", author: "", description: "", license: "", extra: {}, baseUrl: "", current: 0, puzzles: [blankPuzzle()] };
}

// Pack data (checked or not) -> form draft. Takes what it can: the first four
// quartets and the first four words of each.
function packToDraft(data, baseUrl) {
  const d = blankDraft();
  const isPack = isObject(data) && Array.isArray(data.puzzles);
  const puzzles = isPack ? data.puzzles : [data];
  if (isPack) {
    d.title = str(data.title);
    d.author = str(data.author);
    d.description = str(data.description);
    d.license = str(data.license);
    d.extra = pick(data, KNOWN_PACK_KEYS);
  }
  d.baseUrl = baseUrl || "";
  d.puzzles = puzzles.filter(isObject).map(p => {
    const out = blankPuzzle();
    out.title = str(p.title);
    out.subtitle = str(p.subtitle);
    out.winMessage = str(p.winMessage);
    out.extra = pick(p, KNOWN_PUZZLE_KEYS);
    const groups = Array.isArray(p.groups) ? p.groups.filter(isObject).slice(0, 4) : [];
    const voices = groups.map(g => typeof g.voice === "string" ? g.voice.toLowerCase() : "");
    const voicesOk = voices.length === 4 && voices.every(v => VOICES.includes(v)) && new Set(voices).size === 4;
    groups.forEach((g, gi) => {
      const target = out.groups[gi];
      target.name = str(g.name);
      target.voice = voicesOk ? voices[gi] : VOICES[gi];
      target.words = [0, 1, 2, 3].map(wi => Array.isArray(g.words) ? str(g.words[wi]) : "");
      target.details = str(g.details);
      target.extra = pick(g, KNOWN_GROUP_KEYS);
    });
    return out;
  });
  if (!d.puzzles.length) d.puzzles = [blankPuzzle()];
  d.fileName = slugify(d.title || d.puzzles[0].title);
  return d;
}

// Older versions of the game kept a single puzzle as the draft.
function upgradeDraft(saved) {
  if (!isObject(saved)) return null;
  if (Array.isArray(saved.puzzles)) {
    const d = { ...blankDraft(), ...saved };
    d.puzzles = saved.puzzles.map(p => ({ ...blankPuzzle(), ...p, extra: p.extra || {},
      groups: (p.groups || blankPuzzle().groups).map(g => ({ details: "", extra: {}, ...g })) }));
    if (!d.puzzles.length) d.puzzles = [blankPuzzle()];
    d.current = Math.min(Math.max(0, d.current | 0), d.puzzles.length - 1);
    return d;
  }
  if (Array.isArray(saved.groups)) {
    const d = blankDraft();
    d.fileName = str(saved.id);
    const p = blankPuzzle();
    p.title = str(saved.title);
    p.subtitle = str(saved.subtitle);
    p.winMessage = str(saved.winMessage);
    saved.groups.slice(0, 4).forEach((g, gi) => {
      p.groups[gi] = { name: str(g.name), voice: VOICES.includes(g.voice) ? g.voice : VOICES[gi],
        words: [0, 1, 2, 3].map(wi => str((g.words || [])[wi])), details: str(g.details), extra: {} };
    });
    d.puzzles = [p];
    return d;
  }
  return null;
}

function storeDraft(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
}

function restoreDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? upgradeDraft(JSON.parse(raw)) : null;
  } catch (_) { return null; }
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
    fs.querySelector(".g-voice").addEventListener("change", e => {
      fs.className = `compose-group voice-edge-${e.target.value}`;
    });
    c.groups.appendChild(fs);
  });
}

function groupSets() {
  return [...c.groups.querySelectorAll(".compose-group")];
}

// Form -> draft (pack fields and the puzzle on screen).
function syncFromForm() {
  draft.title = c.packTitle.value.trim();
  draft.author = c.author.value.trim();
  draft.description = c.description.value.trim();
  draft.license = c.license.value.trim();
  draft.fileName = c.fileName.value.trim();
  const p = draft.puzzles[draft.current];
  p.title = c.title.value.trim();
  p.subtitle = c.subtitle.value.trim();
  p.winMessage = c.win.value.trim();
  groupSets().forEach((fs, gi) => {
    const g = p.groups[gi];
    g.name = fs.querySelector(".g-name").value.trim();
    g.voice = fs.querySelector(".g-voice").value;
    g.words = [...fs.querySelectorAll(".g-word")].map(i => i.value.trim());
    g.details = fs.querySelector(".g-details").value.trim();
  });
}

// Draft -> form.
function fillForm() {
  c.packTitle.value = draft.title;
  c.author.value = draft.author;
  c.description.value = draft.description;
  c.license.value = draft.license;
  c.fileName.value = draft.fileName;
  fileNameEditedByHand = !!draft.fileName && draft.fileName !== autoFileName();
  fillPuzzle();
}

function fillPuzzle() {
  const p = draft.puzzles[draft.current];
  c.puzzleLegend.textContent = draft.puzzles.length > 1 ? `Puzzle ${draft.current + 1} of ${draft.puzzles.length}` : "Puzzle";
  c.title.value = p.title;
  c.subtitle.value = p.subtitle;
  c.win.value = p.winMessage;
  groupSets().forEach((fs, gi) => {
    const g = p.groups[gi];
    fs.querySelector(".g-name").value = g.name;
    fs.querySelector(".g-voice").value = g.voice;
    fs.className = `compose-group voice-edge-${g.voice}`;
    fs.querySelectorAll(".g-word").forEach((input, wi) => { input.value = g.words[wi] || ""; });
    fs.querySelector(".g-details").value = g.details;
  });
  c.form.querySelectorAll("[aria-invalid]").forEach(n => n.removeAttribute("aria-invalid"));
  renderTabs();
  updateFilePreview();
}

function autoFileName() {
  return slugify(c.packTitle.value || (draft.puzzles[0] && draft.puzzles[0].title) || c.title.value) || "";
}

function updateFilePreview() {
  c.filePreview.textContent = `${c.fileName.value.trim() || autoFileName() || "my-pack"}.json`;
}

function renderTabs(errorPuzzles = new Set()) {
  c.tabs.innerHTML = "";
  draft.puzzles.forEach((p, i) => {
    const b = text("button", `${i + 1}. ${p.title || "Untitled"}`, "tab" + (errorPuzzles.has(i) ? " has-errors" : ""));
    b.type = "button";
    if (i === draft.current) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => switchPuzzle(i));
    c.tabs.appendChild(b);
  });
  c.removeBtn.disabled = draft.puzzles.length < 2;
  c.removeBtn.textContent = pendingRemove ? "Click again to remove" : "Remove this puzzle";
}

function switchPuzzle(i) {
  syncFromForm();
  draft.current = i;
  pendingRemove = false;
  fillPuzzle();
  saveDraft();
  showErrors([]);
}

function saveDraft() {
  storeDraft(DRAFT_KEY, draft);
}

// Checks one puzzle of the draft. When it's the one on screen, marks the
// offending inputs too. Returns a list of problems.
function checkDraftPuzzle(p, onScreen, prefix) {
  const errors = [];
  const sets = onScreen ? groupSets() : null;
  const flag = node => { if (onScreen && node) node.setAttribute("aria-invalid", "true"); };
  const say = msg => errors.push(prefix + msg);

  if (!p.title) { say("Give the puzzle a title."); flag(c.title); }
  p.groups.forEach((g, gi) => {
    const fs = sets && sets[gi];
    const label = `Quartet ${gi + 1}`;
    if (!g.name) { say(`${label} needs a category name.`); flag(fs && fs.querySelector(".g-name")); }
    const blanks = g.words.filter(w => !w).length;
    if (blanks) {
      say(`${label} needs ${blanks === 4 ? "four words" : `${blanks} more word${blanks === 1 ? "" : "s"}`}.`);
      if (fs) fs.querySelectorAll(".g-word").forEach(i => { if (!i.value.trim()) flag(i); });
    }
  });

  const voiceCounts = {};
  p.groups.forEach(g => { voiceCounts[g.voice] = (voiceCounts[g.voice] || 0) + 1; });
  const repeated = VOICES.filter(v => voiceCounts[v] > 1);
  const missing = VOICES.filter(v => !voiceCounts[v]);
  if (repeated.length) {
    say(`Each voice is used once. ${repeated.map(v => VOICE_LABELS[v]).join(" and ")} ${repeated.length === 1 ? "is" : "are"} used twice; ${missing.map(v => VOICE_LABELS[v]).join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`);
    if (sets) sets.forEach((fs, gi) => { if (voiceCounts[p.groups[gi].voice] > 1) flag(fs.querySelector(".g-voice")); });
  }

  const seen = new Map();
  p.groups.forEach((g, gi) => g.words.forEach((w, wi) => {
    if (!w) return;
    const k = normalize(w);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push([gi, wi, w]);
  }));
  seen.forEach(spots => {
    if (spots.length < 2) return;
    say(`"${spots[0][2]}" appears ${spots.length} times. All sixteen words must be different.`);
    if (sets) spots.forEach(([gi, wi]) => flag(sets[gi].querySelectorAll(".g-word")[wi]));
  });

  const names = new Map();
  p.groups.forEach((g, gi) => {
    if (!g.name) return;
    const k = normalize(g.name);
    if (!names.has(k)) names.set(k, []);
    names.get(k).push(gi);
  });
  names.forEach(list => {
    if (list.length < 2) return;
    say(`Quartets ${list.map(i => i + 1).join(" and ")} have the same category name. Each quartet needs its own.`);
    if (sets) list.forEach(gi => flag(sets[gi].querySelector(".g-name")));
  });
  return errors;
}

function showErrors(errors, intro = "Not quite ready yet:") {
  c.errors.innerHTML = "";
  c.errors.classList.toggle("hidden", errors.length === 0);
  if (!errors.length) return;
  const ul = document.createElement("ul");
  errors.slice(0, MAX_LISTED_ERRORS).forEach(e => ul.appendChild(text("li", e)));
  if (errors.length > MAX_LISTED_ERRORS) ul.appendChild(text("li", `…and ${errors.length - MAX_LISTED_ERRORS} more.`));
  c.errors.append(text("p", intro), ul);
  c.errors.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setStatus(nodes, kind = "ok", target = c.status) {
  target.replaceChildren(...nodes);
  target.className = `compose-status ${kind}`;
}

function clearStatus(target = c.status) {
  target.replaceChildren();
  target.className = "compose-status hidden";
}

// Draft puzzle -> puzzle file contents, groups in voice order.
function draftToPuzzle(p) {
  const out = { title: p.title };
  if (p.subtitle) out.subtitle = p.subtitle;
  out.maxMistakes = p.extra.maxMistakes !== undefined ? p.extra.maxMistakes : MAX_MISTAKES;
  if (p.winMessage) out.winMessage = p.winMessage;
  Object.assign(out, pick(p.extra, ["maxMistakes"]));
  out.groups = [...p.groups]
    .sort((a, b) => VOICES.indexOf(a.voice) - VOICES.indexOf(b.voice))
    .map(g => {
      const group = { name: g.name, voice: g.voice, words: g.words };
      if (g.details) group.details = g.details;
      return Object.assign(group, g.extra);
    });
  return out;
}

function draftToPack(d) {
  const out = { formatVersion: FORMAT_VERSION };
  if (d.title) out.title = d.title;
  if (d.author) out.author = d.author;
  if (d.description) out.description = d.description;
  if (d.license) out.license = d.license;
  Object.assign(out, d.extra);
  out.puzzles = d.puzzles.map(draftToPuzzle);
  return out;
}

// Checks the whole draft. Returns the pack, or null after showing the problems.
function checkedPack() {
  syncFromForm();
  const many = draft.puzzles.length > 1;
  const errors = [];
  const bad = new Set();
  draft.puzzles.forEach((p, i) => {
    const prefix = many ? `Puzzle ${i + 1}${quoted(p.title)}: ` : "";
    const found = checkDraftPuzzle(p, i === draft.current, prefix);
    if (found.length) bad.add(i);
    errors.push(...found);
  });
  let pack = null;
  if (!errors.length) {
    pack = draftToPack(draft);
    errors.push(...checkPack(pack).errors);
  }
  renderTabs(bad);
  showErrors(errors);
  return errors.length ? null : pack;
}

function packJson(pack) {
  return JSON.stringify(pack, null, 2) + "\n";
}

function afterExportNodes(first) {
  const help = link("index.html?compose", "build and test a share link");
  const p2 = document.createElement("p");
  p2.className = "muted small";
  p2.append("Next: put the file online somewhere that allows cross-origin access (GitHub Pages, or a gist's Raw link), then ", help, ".");
  return [text("p", first), p2];
}

function downloadPack() {
  const pack = checkedPack();
  if (!pack) return;
  const filename = `${c.fileName.value.trim() || autoFileName() || "my-pack"}.json`;
  const blob = new Blob([packJson(pack)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  c.exportOut.classList.add("hidden");
  const count = pack.puzzles.length;
  setStatus(afterExportNodes(`Downloaded ${filename} (${count} ${count === 1 ? "puzzle" : "puzzles"}).`));
}

async function copyPack() {
  const pack = checkedPack();
  if (!pack) return;
  const json = packJson(pack);
  const copied = await copyText(json, c.copyBtn, "Copy JSON");
  if (copied) {
    c.exportOut.classList.add("hidden");
    setStatus(afterExportNodes("Copied the pack's JSON to the clipboard."));
  } else {
    // No clipboard (for example, an insecure page): show the text to copy by hand.
    c.exportOut.value = json;
    c.exportOut.classList.remove("hidden");
    c.exportOut.select();
    setStatus([text("p", "Your browser didn't allow copying. The JSON is selected below: copy it by hand.")], "warn");
  }
}

function tryCurrent() {
  syncFromForm();
  const p = draft.puzzles[draft.current];
  const errors = checkDraftPuzzle(p, true, "");
  showErrors(errors);
  if (errors.length) return;
  saveDraft();
  const data = draftToPuzzle(p);
  if (data.backgroundImage !== undefined) data.backgroundImage = safeImageUrl(data.backgroundImage, draft.baseUrl);
  backTo = { label: "Back to Compose", href: "index.html?compose=form" };
  try {
    playPuzzle(data);
  } catch (error) {
    showErrors([error.message]);
    return;
  }
  window.scrollTo(0, 0);
}

function addPuzzle() {
  syncFromForm();
  draft.puzzles.push(blankPuzzle());
  draft.current = draft.puzzles.length - 1;
  pendingRemove = false;
  fillPuzzle();
  saveDraft();
  c.title.focus();
}

function removePuzzle() {
  if (draft.puzzles.length < 2) return;
  if (!pendingRemove) {
    pendingRemove = true;
    renderTabs();
    return;
  }
  pendingRemove = false;
  draft.puzzles.splice(draft.current, 1);
  draft.current = Math.min(draft.current, draft.puzzles.length - 1);
  fillPuzzle();
  saveDraft();
}

// ---- Opening an existing pack: by address, from a file, or pasted text.

// Loads pack data into the form, even when it has problems, so they can be fixed here.
function openPackData(data, sourceLabel, baseUrl) {
  const { pack, errors, warnings } = checkPack(data);
  if (!pack) {
    setStatus([text("p", `${sourceLabel} couldn't be opened:`), listOf(errors)], "warn", c.openStatus);
    return;
  }
  syncFromForm();
  undoDraft = draft;
  storeDraft(BACKUP_KEY, draft);
  draft = packToDraft(data, baseUrl);
  fillForm();
  saveDraft();
  showErrors([]);
  clearStatus();

  const count = draft.puzzles.length;
  const undo = text("button", "Undo", "quiet-btn small-btn");
  undo.type = "button";
  undo.addEventListener("click", () => {
    if (!undoDraft) return;
    draft = undoDraft;
    undoDraft = null;
    fillForm();
    saveDraft();
    showErrors([]);
    setStatus([text("p", "Your previous draft is back.")], "ok", c.openStatus);
  });
  const head = document.createElement("p");
  head.append(`Opened ${sourceLabel}: ${count} ${count === 1 ? "puzzle" : "puzzles"}. It replaced your previous draft. `, undo);
  const nodes = [head];
  warnings.forEach(w => nodes.push(text("p", w, "muted small")));
  if (errors.length) {
    nodes.push(text("p", "It has some problems to fix before it can be shared:"), listOf(errors));
    setStatus(nodes, "warn", c.openStatus);
  } else {
    nodes.push(text("p", "It checks out. Edit it, add puzzles, or press Try it out.", "muted small"));
    setStatus(nodes, "ok", c.openStatus);
  }
}

function listOf(items) {
  const ul = document.createElement("ul");
  items.slice(0, MAX_LISTED_ERRORS).forEach(i => ul.appendChild(text("li", i)));
  if (items.length > MAX_LISTED_ERRORS) ul.appendChild(text("li", `…and ${items.length - MAX_LISTED_ERRORS} more.`));
  return ul;
}

function openFailed(error, url) {
  const nodes = [text("p", error.message)];
  if (["blocked", "unreachable", "timeout"].includes(error.kind)) nodes.push(text("p", CORS_HINT, "muted small"));
  const hint = url && addressHint(url);
  if (hint) nodes.push(text("p", hint, "muted small"));
  setStatus(nodes, "warn", c.openStatus);
}

async function openFromUrl() {
  const raw = c.openUrl.value;
  setStatus([text("p", "Loading…")], "ok", c.openStatus);
  c.openUrlBtn.disabled = true;
  let url = "";
  try {
    url = resolvePackUrl(raw);
    const result = await fetchPackData(url);
    openPackData(result.data, "the pack", result.url);
  } catch (error) {
    openFailed(error, url);
  } finally {
    c.openUrlBtn.disabled = false;
  }
}

function openFromFile() {
  const file = c.openFile.files && c.openFile.files[0];
  if (!file) return;
  if (file.size > PACK_MAX_BYTES) {
    setStatus([text("p", `That file is ${Math.round(file.size / 1024)} KB. Packs can be up to ${PACK_MAX_BYTES / 1024 / 1024} MB.`)], "warn", c.openStatus);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try { openPackData(parsePackText(reader.result), `"${file.name}"`, ""); }
    catch (error) { openFailed(error, ""); }
    c.openFile.value = "";
  };
  reader.onerror = () => setStatus([text("p", "That file couldn't be read.")], "warn", c.openStatus);
  reader.readAsText(file);
}

function openFromPaste() {
  const value = c.paste.value;
  if (!value.trim()) {
    setStatus([text("p", "Paste a pack's JSON into the box first.")], "warn", c.openStatus);
    return;
  }
  try { openPackData(parsePackText(value), "the pasted pack", ""); }
  catch (error) { openFailed(error, ""); }
}

function showCompose() {
  el.title.textContent = "Compose";
  el.subtitle.textContent = "Write puzzles of your own, try them out, and export them as a pack to share.";
  el.list.classList.add("hidden");
  el.game.classList.add("hidden");
  el.end.classList.add("hidden");
  el.compose.classList.remove("hidden");
  buildComposeGroups();
  draft = restoreDraft(DRAFT_KEY) || blankDraft();
  fillForm();

  const autoName = () => {
    if (!fileNameEditedByHand) c.fileName.value = autoFileName();
  };
  c.packTitle.addEventListener("input", autoName);
  c.title.addEventListener("input", () => { if (draft.current === 0) autoName(); });
  c.fileName.addEventListener("input", () => { fileNameEditedByHand = c.fileName.value.trim() !== ""; });
  c.form.addEventListener("input", event => {
    updateFilePreview();
    syncFromForm();
    saveDraft();
    if (event.target === c.title) renderTabs();
  });
  c.form.addEventListener("submit", e => { e.preventDefault(); downloadPack(); });
  c.copyBtn.addEventListener("click", copyPack);
  c.tryBtn.addEventListener("click", tryCurrent);
  c.addBtn.addEventListener("click", addPuzzle);
  c.removeBtn.addEventListener("click", removePuzzle);
  c.openUrlBtn.addEventListener("click", openFromUrl);
  c.openUrl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); openFromUrl(); } });
  c.openFile.addEventListener("change", openFromFile);
  c.pasteBtn.addEventListener("click", openFromPaste);
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
  if (qs.get("compose") === "form") showCompose(); else showComposeHelp();
} else if (qs.has("pack")) {
  startPack(qs.get("pack"), qs.get("play"));
} else if (puzzleId) {
  startBuiltInPuzzle(puzzleId);
} else {
  showPuzzleList();
}

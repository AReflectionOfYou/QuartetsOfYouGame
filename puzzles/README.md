# Puzzles

One JSON file per puzzle. The file name (without `.json`) is the puzzle's id,
and the game plays it at `index.html?puzzle=<id>`.

The full format, including multi-puzzle packs, is described in
[docs/PUZZLE_FORMAT.md](../docs/PUZZLE_FORMAT.md), with a formal
[JSON Schema](../schema/quartets-pack.schema.json). The easiest way to write a
puzzle is **Compose** in the game itself (`index.html?compose`), or copy one of
these files and edit it. Compose exports a pack (a `puzzles` list); a pack
file with one puzzle also works in this folder.

## Format

```json
{
  "title": "Opening Night",
  "subtitle": "Optional line under the title.",
  "maxMistakes": 4,
  "winMessage": "Optional message for a full solve.",
  "backgroundImage": "images/optional-background.jpg",
  "groups": [
    { "name": "Citrus fruits", "voice": "bass",    "words": ["Lemon", "Orange", "Grapefruit", "Kumquat"] },
    { "name": "...",           "voice": "tenor",   "words": ["...", "...", "...", "..."] },
    { "name": "...",           "voice": "alto",    "words": ["...", "...", "...", "..."] },
    { "name": "...",           "voice": "soprano", "words": ["...", "...", "...", "..."], "details": "Optional backstory." }
  ]
}
```

Rules, checked when the puzzle loads:

- Exactly four groups, each with a `name` and exactly four `words`.
- All sixteen words must be different, and so must the four group names
  (both ignoring upper and lower case).
- `voice` is `bass` (easiest), `tenor`, `alto` or `soprano` (hardest). Use
  each voice once. If you leave `voice` out of every group, the groups take
  their voices from their order in the file, Bass first.
- `subtitle`, `winMessage`, `maxMistakes` (1 to 10, default 4),
  `backgroundImage` and each group's `details` are optional.
- A `backgroundImage` added to this repo must follow the image policy in the
  main [README](../README.md#image-policy): no photos or likenesses of real
  people, only images created with Claude.

## Listing a puzzle in the Repertoire

Add a line for it to the `PUZZLES` list at the top of `script.js`:

```js
{ id: "opening-night", title: "Opening Night" }
```

Puzzles that aren't listed still play from their direct link.

## Originality

Every puzzle shipped in this folder must be original. Don't copy puzzles,
categories or word sets from The New York Times' Connections or any other
published game.

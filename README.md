# Quartets of You

An open-source word-grouping puzzle: sort sixteen words into four quartets. Write your own puzzles for weddings, reunions, classrooms, or family nights.

Part of the [A Reflection of You](https://github.com/AReflectionOfYou) collection, tools and games that reflect the people who use them. It grew out of a small puzzle game made for a family wedding.

## How to play

- Sixteen words hide four quartets of four. Tap four words that belong together and press **Submit**.
- The quartets are named for choir voices, from easiest to hardest: **Bass**, **Tenor**, **Alto** and **Soprano**. Each solved row shows its voice name and initial (B, T, A, S) as well as its color.
- A wrong guess is a **bum note**. Four bum notes end the performance.
- **Rehearse** shuffles the board.
- **Tutti** is an optional challenge before you start: sort all sixteen words into four rows and submit once. A row counts only if all four of its words belong to the same quartet. Get every row right for a **Bravo!** and a conductor's baton mark on your results. Otherwise, the rows you got right carry over and you play the rest as normal.
- The results read like a concert program, listing each voice in the order you found it.
- At the end, **Copy results** (or **Share** on phones) gives you a box score to paste anywhere: one row per guess, each word shown as its voice's note: ♩ Bass, ♪ Tenor, ♫ Alto, ♬ Soprano. A row of four matching notes is a quartet found. It never gives away the words, and it ends with a link to the same puzzle.

## Run it locally

There is no build step and there are no dependencies. Puzzles load with `fetch`, so serve the folder rather than opening the file directly:

```sh
cd QuartetsOfYouGame
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The puzzle picker is the **Repertoire**. Any static host works, including GitHub Pages.

## Play a puzzle pack from anywhere

Anyone can write a **puzzle pack**, a single JSON file with one or more puzzles, host it on their own site, and share a link. Nothing in this repo has to change:

```
https://<the game's address>/?pack=https://example.org/my-pack.json
```

The pack's host must allow cross-origin access so the game can read it; GitHub Pages and a gist's Raw link both work. The easiest start is the [puzzle pack template](https://github.com/AReflectionOfYou/quartets-puzzle-pack-template). The game only reads packs, checks them against the format, and explains any problem it finds. Try the example: `index.html?pack=docs/example-pack.json`.

- **[Puzzle format guide](docs/PUZZLE_FORMAT.md)**: every field, the rules, and a complete example to copy.
- [JSON Schema](schema/quartets-pack.schema.json) for the format, and the [example pack](docs/example-pack.json).

- **[Puzzle pack template](https://github.com/AReflectionOfYou/quartets-puzzle-pack-template)**: a GitHub template repository for hosting your own packs, with sample packs, GitHub Pages hosting steps, and a check that validates every pack on each commit.

Pack authors own their puzzles and choose how others may use them.

## Write your own puzzles

Open **Compose** from the Repertoire, or go to `index.html?compose`. It offers three ways in:

1. **Use the form** (`index.html?compose=form`). Enter one or more puzzles: a title and four quartets, each with a category, four words, a voice and an optional backstory. **Try it out** plays the puzzle on screen. **Download pack** and **Copy JSON** check every puzzle (each quartet complete, each voice used once, all sixteen words different) and export the pack. **Open a pack** loads an existing pack from a web address, a file or pasted text, so you can edit or extend it.
2. **Write a pack by hand**, following the [format guide](docs/PUZZLE_FORMAT.md).
3. **Brainstorm with an AI**: give an assistant the format guide, ask for a pack, and paste its answer into the form to check and preview it.

The Compose page also has a helper that test-loads your hosted pack and builds the `?pack=` link to share.

Your draft is kept in the browser while you work, so you can go back and forth between Compose and Try it out.

To add a puzzle to this repo's built-in Repertoire, put its file in [puzzles/](puzzles) and add a line to the `PUZZLES` list at the top of [script.js](script.js); see [puzzles/README.md](puzzles/README.md).

## Versions

The game's version appears at the bottom of every screen and in the About panel, so you can tell which release a browser is running. About also has a **Having problems?** link that offers to open a new GitHub issue for the game with the version and browser filled in (reporting an issue needs a GitHub account). When you change the game, bump the number in [index.html](index.html): in the `version` meta tag, in the `?v=` on the stylesheet and script links, and in the footer. The `?v=` change makes browsers fetch the new files instead of a saved copy. A check on every push makes sure all the copies match.

## Accessibility

The four voice colors are warm shades from deep oxblood (Bass) to pale apricot (Soprano). Each is about twice as bright as the one before, so they stay distinct for colorblind players, and color is never the only cue: every solved row and program entry carries its voice name and initial. The Bravo celebration is visual only, with no sound, and its animation is turned off for players who ask their system for reduced motion.

## Disclaimer

Quartets of You is an independent open-source project. It is not affiliated with, endorsed by, or connected to The New York Times, and it is not the New York Times Connections game. It doesn't use the Times' colors, layout or puzzle content, and every sample puzzle in this repository is original. If you contribute puzzles, please make sure they are your own.

## Before a public release

- [x] Name check: Quartets of You is clear to use.
  - November 2026: no other GitHub repository or app with this name turned up. Several "quartet" card-game apps exist, and Apple holds a QUARTILES mark for online word puzzle games.
- [x] Open-source license chosen: MIT.

## License

Code is under the [MIT License](LICENSE). Documents, written content, images, audio, and video are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [LICENSE-CONTENT](LICENSE-CONTENT). © 2026 Michael A. Heroux.

## Image policy

No photos or likenesses of any real person, living or dead, appear in this repo or on anything built from it. All images are created together with Claude, so Michael A. Heroux owns them and they are licensed CC BY 4.0. The only exception is Michael himself: his standard professional portrait and an occasional informal photo. Any other exception needs Michael's explicit approval for that specific case. Future contributors, including AI coding sessions, must follow this policy.

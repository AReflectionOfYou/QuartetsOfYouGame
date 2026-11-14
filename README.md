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

## Run it locally

There is no build step and there are no dependencies. Puzzles load with `fetch`, so serve the folder rather than opening the file directly:

```sh
cd QuartetsOfYouGame
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The puzzle picker is the **Repertoire**. Any static host works, including GitHub Pages.

## Write your own puzzles

Open **Compose** from the Repertoire, or go to `index.html?compose`.

1. Enter a title and four quartets. Each quartet has a category name, four words and a voice. You can add an optional backstory that pops up when the quartet is solved.
2. Press **Try it out** to play it straight away.
3. Press **Save puzzle**. Compose first checks that every quartet is complete, that each voice is used once, and that all sixteen words are different.
   - **Chrome and Edge:** the first time you save, choose the game's `puzzles` folder. The game remembers it and saves straight into it after that.
   - **Other browsers:** the puzzle downloads as a JSON file. Move it into the `puzzles` folder.
4. To list the puzzle in the Repertoire, add the line Compose shows you to the `PUZZLES` list at the top of [script.js](script.js). A puzzle that isn't listed still plays at `index.html?puzzle=<file-name>`.

Your draft is kept in the browser while you work, so you can go back and forth between Compose and Try it out. The puzzle file format is described in [puzzles/README.md](puzzles/README.md).

## Accessibility

The four voice colors are warm shades from deep oxblood (Bass) to pale apricot (Soprano). Each is about twice as bright as the one before, so they stay distinct for colorblind players, and color is never the only cue: every solved row and program entry carries its voice name and initial. The Bravo celebration is visual only, with no sound, and its animation is turned off for players who ask their system for reduced motion.

## Disclaimer

Quartets of You is an independent open-source project. It is not affiliated with, endorsed by, or connected to The New York Times, and it is not the New York Times Connections game. It doesn't use the Times' colors, layout or puzzle content, and every sample puzzle in this repository is original. If you contribute puzzles, please make sure they are your own.

## Before a public release

- [ ] Check that the name Quartets of You is free on GitHub (planned repo name: `quartets-of-you`), in the Apple App Store and Google Play, and in the [USPTO trademark search](https://tmsearch.uspto.gov/).
  - Preliminary check, November 2026: no other GitHub repository or app with this name turned up. Several "quartet" card-game apps exist, and Apple holds a QUARTILES mark for online word puzzle games, so confirm "Quartets of You" in the USPTO search before release.
- [x] Open-source license chosen: MIT.

## License

MIT. See [LICENSE](LICENSE).

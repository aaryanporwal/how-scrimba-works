# Scrimba-Style Timeline Demo

https://github.com/user-attachments/assets/bac3cd6b-b659-495d-8a4e-ea442ff92d3


A tiny React demo of the core idea behind Scrimba: code lessons do not have to be flat videos. They can be replayable, editable timelines.

This app plays through a short HTML/CSS lesson. As the timeline moves, the Monaco editor jumps between recorded code states and the iframe preview renders the current result. Pause anywhere, edit the code, and the preview updates immediately.

## Why this exists

Scrimba's real product is much more sophisticated, but its magic trick is wonderfully simple to explain: record what happened, then replay it as an interactive coding environment.

Scrimba's team has described the architecture as recording browser events instead of pixels. A Stack Overflow answer from a Scrimba team member says Scrimba records clicks, mouse events, key events, and similar browser activity, then replays them. Per Harald Borgen described the same idea on Hacker News: Scrimba records events, including interactions with the live preview through a DOM recorder, so playback is a recreation of the original in-browser session.

This repo is the toy version: instead of recording every event, it stores a few timestamped code snapshots.

## How it works

- `timeline` is an array of `{ time, code }` snapshots.
- The range slider controls lesson progress from `0` to `100`.
- `codeAt(progress)` finds the latest snapshot at that point in time.
- Playback uses `requestAnimationFrame` to move through the lesson smoothly.
- Monaco renders the editable code.
- An iframe renders the live preview with `srcDoc`.

That gives the same basic feel: watch, pause, change the instructor's code, and keep exploring. Tiny idea, big teaching upgrade.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints.

## Build

```bash
npm run build
```

## Sources

- [Scrimba.com interactive DOM recording algorithm - Stack Overflow](https://stackoverflow.com/questions/55345973/scrimba-com-interactive-dom-recording-algorithm)
- [Per Harald Borgen on Hacker News: Scrimba records events instead of pixels](https://news.ycombinator.com/item?id=14299979)
- [Scrimba About page: scrims are a new video format for code screencasts](https://m.scrimba.com/about)

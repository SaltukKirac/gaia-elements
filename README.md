# gaia-elements

Front-end code of the Gaia (Octonom) Bubble HTML elements, served to the Bubble app through jsDelivr.

- Bubble keeps only a small stub per element (its dynamic header + `<div data-gx-el="NAME">` + a loader script).
- `loader.js` reads `manifest.json` (element -> commit) and mounts `el/NAME.html` from that exact commit.
- `stubs/NAME.html` is what sits in the Bubble HTML element (for reference).

This repository is written by a deploy script; do not edit files here by hand.
Copyright (c) Gaia / Octonom. All rights reserved. Not open source.

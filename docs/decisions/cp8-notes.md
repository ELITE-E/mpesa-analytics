# CP8 notes

Things to act on at CP8. Add to this file as they come up; do not bury them in other records.

## Timeout

The adapter's deadline in `pdf_reader/pdfjs/adapter.js` is a timer plus a check after opening the document and after each page.

- **Under Node, a stuck step cannot be interrupted.** pdf.js runs on the same thread there, so a slow step is only noticed once it finishes. A 1 ms timeout on F-DENSE reports `TIMEOUT` after about 700 ms on the dev machine.
- **A real browser worker is untested.** There pdf.js has its own thread, so the timer should fire on time, but no test has shown it. CP8 should measure this in a browser, including that `loadingTask.destroy()` actually stops a slow page.

## Legacy build

- **The tested build is not the shipped build.** Node tests use `legacy/build/pdf.min.mjs` from pdfjs-dist 6.4.299, because the modern `build/pdf.min.mjs` needs `Uint8Array.prototype.toHex`, which Node 24 lacks. The browser is meant to load the modern build, which has no automated test yet.
- **Recorded fixtures come from the legacy build.** Every `items.json` is recorded with it. CP8 should compare both builds on the fixtures in a browser and record any differences.
- **Browser support needs checking.** The modern build requires `toHex`, so any target browser without it cannot load the app with this build. Which browsers that excludes has not been checked.

## Bundle budget

`tools/measure_bundle.py` prints NOT ENFORCED and is not a CI gate until CP8. ADR 0006 says it fails CI over budget, so CP8 should turn that on or change the ADR.

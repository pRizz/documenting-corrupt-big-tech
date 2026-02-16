# documenting-corrupt-big-tech

## iPhone Mirroring autofill capture automation

This repo contains `scripts/iphone-mirror-autofill-capture.sh`, a legacy Bash reference implementation for driving an
open iPhone Mirroring window and recording screenshots of autofill-style search suggestions as characters are typed
into Chrome, Instagram, and TikTok.

The canonical automation is now implemented as a Bun + TypeScript CLI in `src/cli.ts`.

### Prerequisites

- macOS with iPhone Mirroring open
- Accessibility + Screen Recording enabled for your terminal application
- Use the macOS Terminal.app (recommended first) for permission prompts; some embedded terminals can fail to receive Automation prompts reliably.
- If using an embedded terminal (Cursor, editors, etc.), grant permissions to that app too.
- `cliclick` (install with `brew install cliclick`)

### Quickstart (Bun)

```bash
bun install
bun run capture -- --query "pizza" --apps chrome,instagram,tiktok
```

You can also pass a specific output folder:

```bash
bun run capture -- --query "pizza" --apps chrome,instagram,tiktok --out ./outdir
```

### Command examples

```bash
bun run capture -- --print-window
bun run capture -- --coord-to-rel 100 100
bun run capture -- --point-check 0.5 0.1
bun run capture -- --query "a" --apps chrome
bun run capture -- --calibrate
bun run capture -- --calibrate-action chrome:searchBar
bun run preflight
bun run check-mirror
bun run sanity-capture -- --query "a"
```

### Pre-action delay and logging verbosity

Capture flow now includes a stabilization pause before app actions:

- `CAPTURE_PRE_ACTION_DELAY_SEC` (default: `4`)
  - set to `3`/`4`/`5` to tune for your machine
  - set to `0` to disable the wait
- `CAPTURE_STEP_GAP_SEC` (default: `4`)
  - adds a short delay between major scripted actions (tap/key/type transitions)
  - useful to avoid UI race conditions and stabilize iPhone mirroring interactions
  - set to `0.75` or higher on slower machines
  - set to `0` to keep current fast burst mode
- `CAPTURE_FAST_STEP_GAP_SEC` (default: `0.7`)
  - used by the launch path up to app-open completion (home/search entry, search submit, and search-fallback transition)
  - recommended default keeps validated pre-open steps responsive while preserving stability
  - set higher or lower if your mirror timing needs it
- `CAPTURE_USE_MIRROR_SHORTCUTS` (default: `1`)
  - set to `1`/`true` (default) to use iPhone Mirroring shortcuts
  - set to `0`/`false` to force legacy navigation (`Command+H` + swipe and Search icon tap)
```bash
CAPTURE_PRE_ACTION_DELAY_SEC=5 bun run capture -- --query "a" --apps chrome
CAPTURE_PRE_ACTION_DELAY_SEC=5 CAPTURE_STEP_GAP_SEC=0.75 bun run capture -- --query "a" --apps chrome
CAPTURE_FAST_STEP_GAP_SEC=0.45 bun run capture -- --query "a" --apps chrome
CAPTURE_PRE_ACTION_DELAY_SEC=4 CAPTURE_STEP_GAP_SEC=4 CAPTURE_FAST_STEP_GAP_SEC=0.7 bun run capture -- --query "a" --apps chrome
CAPTURE_USE_MIRROR_SHORTCUTS=0 bun run capture -- --query "a" --apps chrome
```

AppleScript/probe logging is intentionally quiet by default. Enable detailed logs with:

```bash
PRINT_WINDOW_DEBUG=1 bun run capture -- --query "a" --apps chrome
```

### Search launch flow and base coordinates

The Bun runtime now prefers iPhone Mirroring shortcuts, with legacy fallback:

1. Return to Home (Command+1)
2. Open Search UI (Command+3)  
   - if this fails, fallback to tapping the calibrated Search icon
3. Clear search field and type app name (`Chrome`, `Instagram`, `TikTok`)
4. Submit the search with Enter so the first search result is selected
5. Continue with in-app search steps

`--calibrate` now captures the Search point interactively:

1. Open the mirrored iPhone and start `bun run capture -- --calibrate`.
2. Move your mouse so it is over the iPhone **Search** icon.
3. Press Enter in the terminal when positioned.
4. While you move the mouse, terminal output updates a live single-line telemetry stream showing:
   - source of raw sample (`osascript` or fallback),
   - screen absolute coordinates,
   - active content region,
   - content-local pixel coordinates,
   - normalized relative coordinates,
   - and an `[OUT OF CONTENT REGION]` marker if the cursor is outside the current mirroring content area.
   - Example: `Calibration preview [Target: iPhone Home Screen Search button]: source=osascript raw={1245, 612} | screen=(1245, 612) | contentRegion=(x=1120, y=84, w=296, h=638) | contentLocal=(125, 528) | rel=(0.422297, 0.827586)`.
5. Pressing Enter immediately captures the current value and records both absolute and normalized coordinates into `calibration/base-coordinates.json`:
   - `points.homeSearchButton.absX`, `points.homeSearchButton.absY`
   - `points.homeSearchButton.relX`, `points.homeSearchButton.relY`
6. The command prints the computed mirrored content region before sampling so you can verify the coordinate frame.

You can re-run calibration later if app layout changes.

This behavior is controlled by:

- `calibration/base-coordinates.json`

If calibration data is missing or invalid, capture mode exits with explicit guidance to rerun:

```bash
bun run capture -- --calibrate
```

`bun run capture -- --calibrate` now writes:

- `calibration/iphone_content.png`
- `calibration/base-coordinates.json`

The legacy icon-based app launch remains available internally as a fallback only.

### Action calibration framework

You can calibrate additional in-app action points and persist them in `calibration/base-coordinates.json` without changing behavior for every run.

Supported action IDs:

- `chrome:searchBar`

For a new action:

1. Ensure the baseline file exists (`bun run capture -- --calibrate`).
2. Run:

```bash
bun run capture -- --calibrate-action chrome:searchBar
```

3. Move your mouse over the target point and press Enter when ready.
4. The selected point is stored under:

- `points.appActionPoints.chrome.searchBar`

During capture, if `chrome:searchBar` is available, the Chrome flow uses that point before falling back to `appSearchSteps`.

Precedence:

1. calibrated action point (highest)
2. legacy step sequence from `appSearchSteps` (fallback)

Convenience targets:

```bash
just calibrate-action app=chrome action=searchBar
just calibrate-chrome-search-bar
```

### Convenience commands (Justfile)

```bash
just capture-all query="pizza"
just capture-chrome query="pizza" out="./out/chrome_run"
just capture-instagram query="pizza"
just capture-tiktok query="pizza"
just preflight
just check-mirror
just check-mirror debug=1
just calibrate
just calibrate-action app=chrome action=searchBar
just calibrate-chrome-search-bar
just sanity-capture query="a"
just print-window
```

### Legacy bash reference

- `scripts/iphone-mirror-autofill-capture.sh` is kept unchanged as historical/for-audit reference.
- It is no longer the primary runtime; use `bun run capture ...` for routine execution.
- Keep the Bash script if you need a quick side-by-side behavior diff.

### Recommended sanity workflow before full capture

1. `bun run preflight`
2. `bun run check-mirror`
3. If needed: `bun run check-mirror debug=1`
4. Use strict coordinate checks while calibrating:
   - `PRINT_WINDOW_DEBUG=1 bun run capture -- --print-window`
   - `bun run preflight` (or `just preflight`)
   - `bun run capture -- --point-check 0.50 0.10` (replace with any rel coordinate under test)
5. `bun run capture -- --calibrate`
6. `bun run sanity-capture -- --query "a"`
7. `bun run capture -- --query "pizza" --apps chrome,instagram,tiktok` once input and taps are stable
8. During `--calibrate`, move your mouse to the mirrored Search button and press Enter when ready.
9. The calibration file now stores both absolute and relative coordinates for the Search point, plus absolute+relative launch-result metadata for traceability.

### Calibration and one-app validation workflow

Use this order when bringing up a new setup or after UI changes:

1. Prepare environment and mirror:
   - `bun run preflight`
   - `bun run print-window`
2. Capture fresh coordinates:
   - `bun run capture -- --calibrate`
   - Keep both terminal and iPhone mirroring visible.
   - Place the mouse over the mirrored iPhone Search icon.
   - Ensure terminal is focused and press Enter to record the point.
   - Verify both files were written:
     - `calibration/iphone_content.png`
     - `calibration/base-coordinates.json`
3. Validate one app at a time (use a short one-char query):
   - `bun run capture -- --query "a" --apps chrome`
   - `bun run capture -- --query "a" --apps instagram`
   - `bun run capture -- --query "a" --apps tiktok`
4. Confirm each run reports:
   - `Done. Output: ...`
   - output directories contain the expected per-app captures.
5. Optional spot checks:
   - `bun run capture -- --coord-to-rel 100 100`
   - `bun run capture -- --point-check 0.5 0.1`
6. If any app misfires:
   - rerun `bun run capture -- --calibrate`
   - re-test only the failing app first before doing multi-app captures.

### Notes

- App icon positions and search-entry taps are still present as legacy fallback and are reflected in `src/utils.ts` defaults.
- Use `bun run capture -- --print-window` or `bun run capture -- --calibrate` to validate the cropped content area.
- If automation fails, rerun after adjusting coordinates and delays.
- If you see connection errors in an embedded terminal, run the command from macOS Terminal.app after enabling `Accessibility` and `Automation` for Terminal and `System Events`.
- For mirror detection issues, run with verbose tracing to show each probe step:
  - `PRINT_WINDOW_DEBUG=1 bun run capture -- --print-window`
- The conversion pipeline is strict-validated; debug output includes raw rel inputs, computed absolute points, and parsed click payloads when failures occur.
- If tracing shows no readable bounds while the phone UI is visible, verify on-screen:
  - select your device in iPhone Mirroring
  - accept pairing prompts on the phone (including passcode)
  - tap **Connect**
  - wait until the mirrored screen is visible before re-running

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
bun run preflight
bun run check-mirror
bun run sanity-capture -- --query "a"
```

### Search launch flow and base coordinates

The Bun runtime now opens apps by tapping the iPhone home **Search** button first:

1. Return to Home
2. Tap Search button
3. Clear search field and type app name (`Chrome`, `Instagram`, `TikTok`)
4. Tap the launch result entry
5. Continue with in-app search steps

`--calibrate` now captures the Search point interactively:

1. Open the mirrored iPhone and start `bun run capture -- --calibrate`.
2. Move your mouse so it is over the iPhone **Search** icon.
3. Press Enter in the terminal when positioned.
4. The script records both absolute and normalized coordinates into `calibration/base-coordinates.json`:
   - `points.homeSearchButton.absX`, `points.homeSearchButton.absY`
   - `points.homeSearchButton.relX`, `points.homeSearchButton.relY`
5. The command prints the computed mirrored content region before sampling so you can verify the coordinate frame.

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

### Convenience commands (Justfile)

```bash
just capture-all query="pizza"
just capture-chrome query="pizza" out="./out/chrome_run"
just capture-instagram query="pizza"
just capture-tiktok query="pizza"
just preflight
just check-mirror
just check-mirror debug=1
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

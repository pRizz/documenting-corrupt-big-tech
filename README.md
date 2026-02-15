# documenting-corrupt-big-tech

## iPhone Mirroring autofill capture automation

This repo contains `scripts/iphone-mirror-autofill-capture.sh`, a macOS helper that drives an
open iPhone Mirroring window and records screenshots of autofill-style search suggestions as characters are
typed into Chrome, Instagram, and TikTok.

### Prerequisites

- macOS with iPhone Mirroring open
- Accessibility + Screen Recording enabled for your terminal application
- Use the stock macOS Terminal.app (recommended first) for permission prompts; some embedded terminals can fail to receive Automation prompts reliably.
- If using an embedded terminal (Cursor, editors, etc.), grant permissions to that app too.
- `cliclick` (install with `brew install cliclick`)

### Run

```bash
./scripts/iphone-mirror-autofill-capture.sh --query "pizza" --apps chrome,instagram,tiktok
```

### Convenience commands (Justfile)

```bash
just capture-all query="pizza"
just capture-chrome query="pizza" out="./out/chrome_run"
just preflight
just check-mirror
just check-mirror debug=1
just sanity-capture query="a"
just calibrate
just print-window
```

### Recommended sanity workflow before full capture

1. `just preflight`
2. `just check-mirror`
3. If needed: `just check-mirror debug=1`
4. Use strict coordinate checks while calibrating:
   - `PRINT_WINDOW_DEBUG=1 ./scripts/iphone-mirror-autofill-capture.sh --print-window`
   - `just point-check 0.50 0.10` (replace with any rel coordinate under test)
5. `just calibrate` (or `--calibrate`) to validate the cropped content area
6. `just sanity-capture query="a"` for a one-app, minimal capture check
7. `just capture-all query="..."` once input and taps are stable

### Notes

- App icon positions and search-entry taps are hard-coded for one layout and intended to be calibrated.
- Use `just calibrate` (or `--calibrate`) to verify the cropped phone content region.
- Use `--coord-to-rel X Y` while hovering over mirrored points for fine-tuning taps.
- If automation fails, rerun after adjusting coordinates and delays.
- If you see connection errors in an embedded terminal, run the command from macOS Terminal.app after enabling `Accessibility` and `Automation` for Terminal and `System Events`.
- If using Terminal.app, keep it as the default runner for the initial permission grant flow.
- For mirror detection issues, run with verbose tracing to show each probe step:
  - `PRINT_WINDOW_DEBUG=1 ./scripts/iphone-mirror-autofill-capture.sh --print-window`
- The conversion pipeline is now strict-validated; debug output includes raw rel inputs, computed absolute points, and parsed click payloads when failures occur.
- If tracing shows no readable bounds while the phone UI is visible, verify on-screen:
  - select your device in iPhone Mirroring
  - accept pairing prompts on the phone (including passcode)
  - tap **Connect**
  - wait until the mirrored screen is visible before re-running

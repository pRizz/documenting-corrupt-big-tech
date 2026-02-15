set shell := ["/bin/bash", "-uc"]

SCRIPT := "./scripts/iphone-mirror-autofill-capture.sh"

default:
  @just --list

capture-all query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} --query "{{query}}" --apps "chrome,instagram,tiktok" --out "{{out}}"; \
  else \
    {{SCRIPT}} --query "{{query}}" --apps "chrome,instagram,tiktok"; \
  fi

capture-chrome query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} --query "{{query}}" --apps "chrome" --out "{{out}}"; \
  else \
    {{SCRIPT}} --query "{{query}}" --apps "chrome"; \
  fi

capture-instagram query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} --query "{{query}}" --apps "instagram" --out "{{out}}"; \
  else \
    {{SCRIPT}} --query "{{query}}" --apps "instagram"; \
  fi

capture-tiktok query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} --query "{{query}}" --apps "tiktok" --out "{{out}}"; \
  else \
    {{SCRIPT}} --query "{{query}}" --apps "tiktok"; \
  fi

preflight:
  @if ! command -v osascript >/dev/null 2>&1; then \
    echo "Missing: osascript (macOS built-in)."; \
    exit 1; \
  fi
  @if ! command -v awk >/dev/null 2>&1; then \
    echo "Missing: awk (macOS built-in)."; \
    exit 1; \
  fi
  @if ! command -v cliclick >/dev/null 2>&1; then \
    echo "Missing: cliclick. Install with: brew install cliclick"; \
    exit 1; \
  fi
  @if ! command -v screencapture >/dev/null 2>&1; then \
    echo "Missing: screencapture (macOS built-in)."; \
    exit 1; \
  fi
  @if [ ! -x {{SCRIPT}} ]; then \
    echo "Script not executable: {{SCRIPT}}"; \
    exit 1; \
  fi
  @echo "Preflight checks passed."

check-mirror debug="0":
  @if [ "{{debug}}" = "1" ]; then \
    PRINT_WINDOW_DEBUG=1 {{SCRIPT}} --print-window; \
  else \
    {{SCRIPT}} --print-window; \
  fi

sanity-capture query out="":
  @if [ -z "{{query}}" ]; then \
    echo "sanity-capture requires --query; e.g. just sanity-capture query=\"a\""; \
    exit 1; \
  fi
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} --query "{{query}}" --apps "chrome" --out "{{out}}"; \
  else \
    {{SCRIPT}} --query "{{query}}" --apps "chrome"; \
  fi

print-window:
  @{{SCRIPT}} --print-window

calibrate:
  @{{SCRIPT}} --calibrate

coord-to-rel x y:
  @{{SCRIPT}} --coord-to-rel "{{x}}" "{{y}}"

point-check rx ry:
  @{{SCRIPT}} --point-check "{{rx}}" "{{ry}}"

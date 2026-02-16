set shell := ["/bin/bash", "-uc"]

SCRIPT := "bun run capture --"

default:
  @just --list

capture-all query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome,instagram,tiktok" --out "{{out}}"; \
  else \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome,instagram,tiktok"; \
  fi

capture-chrome query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome" --out "{{out}}"; \
  else \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome"; \
  fi

capture-instagram query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} -- --query "{{query}}" --apps "instagram" --out "{{out}}"; \
  else \
    {{SCRIPT}} -- --query "{{query}}" --apps "instagram"; \
  fi

capture-tiktok query out="":
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} -- --query "{{query}}" --apps "tiktok" --out "{{out}}"; \
  else \
    {{SCRIPT}} -- --query "{{query}}" --apps "tiktok"; \
  fi

preflight:
  @bun run preflight

pre-commit:
  @bun run pre-commit

install-hooks:
  @scripts/install-hooks.sh

check-mirror debug="0":
  @if [ "{{debug}}" = "1" ]; then \
    PRINT_WINDOW_DEBUG=1 {{SCRIPT}} -- --print-window; \
  else \
    {{SCRIPT}} -- --print-window; \
  fi

sanity-capture query out="":
  @if [ -z "{{query}}" ]; then \
    echo "sanity-capture requires --query; e.g. just sanity-capture query=\"a\""; \
    exit 1; \
  fi
  @if [ -n "{{out}}" ]; then \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome" --out "{{out}}"; \
  else \
    {{SCRIPT}} -- --query "{{query}}" --apps "chrome"; \
  fi

print-window:
  @{{SCRIPT}} -- --print-window

calibrate:
  @{{SCRIPT}} -- --calibrate

calibrate-all:
  @{{SCRIPT}} -- --calibrate-all

debug-calibrate-all:
  @{{SCRIPT}} -- --debug-calibrate-all

calibrate-action app action:
  @{{SCRIPT}} -- --calibrate-action "{{app}}:{{action}}"

calibrate-chrome-search-bar:
  @{{SCRIPT}} -- --calibrate-action "chrome:searchBar"

calibrate-action-chrome-search-icon:
  @{{SCRIPT}} -- --calibrate-action "chrome:searchIcon"

calibrate-action-chrome-ellipsis:
  @{{SCRIPT}} -- --calibrate-action "chrome:ellipsis"

calibrate-action-chrome-new-incognito-tab:
  @{{SCRIPT}} -- --calibrate-action "chrome:newIncognitoTab"

coord-to-rel x y:
  @{{SCRIPT}} -- --coord-to-rel "{{x}}" "{{y}}"

point-check rx ry:
  @{{SCRIPT}} -- --point-check "{{rx}}" "{{ry}}"

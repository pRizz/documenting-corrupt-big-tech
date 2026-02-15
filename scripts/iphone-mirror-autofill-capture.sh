#!/usr/bin/env bash

set -euo pipefail

# =========================
# User config
# =========================

MIRROR_APP_NAME="iPhone Mirroring"

INSET_LEFT=10
INSET_TOP=48
INSET_RIGHT=10
INSET_BOTTOM=10

# Set to 2 if your coordinates are consistently doubled on a particular setup.
COORD_SCALE=1

CHAR_DELAY_SEC=0.25
APP_OPEN_DELAY_SEC=1.0

# Home screen icon coordinates (relative 0..1) inside the mirrored phone content.
CHROME_ICON_RX=0.18
CHROME_ICON_RY=0.78

INSTAGRAM_ICON_RX=0.40
INSTAGRAM_ICON_RY=0.78

TIKTOK_ICON_RX=0.62
TIKTOK_ICON_RY=0.78

# Tap sequences to reach each app search field (semicolons separate steps).
CHROME_SEARCH_STEPS="0.50,0.10"
INSTAGRAM_SEARCH_STEPS="0.20,0.95;0.50,0.12"
TIKTOK_SEARCH_STEPS="0.92,0.08;0.50,0.12"

# select_all: sends Cmd+A then delete.
# backspace:N: sends Delete N times.
CLEAR_MODE="select_all"
BACKSPACE_COUNT=40

# Set to 0 to skip window/probe diagnostics on failure.
PRINT_WINDOW_DEBUG="${PRINT_WINDOW_DEBUG:-1}"

# Fallback process name for macOS versions where mirroring is hosted by QuickTime Player.
MIRROR_APP_FALLBACK="QuickTime Player"

LOG_PREFIX="iphone-mirror-autofill"

# =========================

usage() {
	cat <<'EOF'
Usage:
  iphone-mirror-autofill-capture.sh --query "pizza" --apps chrome,instagram,tiktok [--out ./outdir]

Modes:
  --query "text"         Required search text to type one character at a time
  --apps "a,b,c"         Required app list (chrome,instagram,tiktok) any subset
  --out path             Optional output folder (defaults to ./autofill_shots_YYYYmmdd_HHMMSS)

Utility:
  --print-window         Print iPhone mirroring window bounds and computed content bounds
  --calibrate            Capture a crop preview of the current phone content region
  --coord-to-rel X Y     Convert absolute screen coordinates to relative (0..1)
  -h, --help             Print this help text

Requirements:
  - macOS
  - iPhone Mirroring open and visible
  - Accessibility + Screen Recording for your terminal app
  - Commands: osascript, cliclick, screencapture, awk
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

need_cmd() {
	local cmd="$1"
	local hint="${2:-}"

	command -v "$cmd" >/dev/null 2>&1 || {
		if [[ -n "$hint" ]]; then
			die "Missing required command: ${cmd}. ${hint}"
		else
			die "Missing required command: ${cmd}."
		fi
	}
}

osascript_eval() {
	osascript -e "$1"
}

log_step() {
	if ((PRINT_WINDOW_DEBUG)); then
		echo "[${LOG_PREFIX}] $(date '+%H:%M:%S') - $1" >&2
	fi
}

log_payload() {
	local label="$1"
	local payload="$2"
	if ((PRINT_WINDOW_DEBUG)); then
		echo "[${LOG_PREFIX}] ${label}: ${payload}" >&2
	fi
}

mirroring_connection_hint() {
	cat <<'EOF' >&2
If the phone is not actively mirrored, complete the iPhone Mirroring connection flow on-screen:
 - In iPhone Mirroring on macOS, select your iPhone
 - Accept any pairing prompt and enter the passcode on your iPhone if requested
 - Tap "Connect" (or equivalent) to establish the Mirroring session
 - Wait until the phone UI is visible in the window before rerunning this script
 - If the UI is visible but automation still fails, verify:
   - Prefer using the macOS Terminal.app for initial Automation/Accessibility permission prompts
   - System Settings > Privacy & Security > Accessibility includes your terminal app
   - System Settings > Privacy & Security > Automation allows your terminal app to control System Events and iPhone Mirroring
EOF
}

die_with_connection_hint() {
	local msg="$1"
	echo "error: ${msg}" >&2
	mirroring_connection_hint
	exit 1
}

fail_with_connection_hint() {
	local msg="$1"
	echo "error: ${msg}" >&2
	mirroring_connection_hint
	return 1
}

trim() {
	local s="$1"
	s="${s#"${s%%[![:space:]]*}"}"
	s="${s%"${s##*[![:space:]]}"}"
	printf "%s" "$s"
}

print_mirror_debug_probe() {
	local script
	local out
	log_step "Running detailed mirroring probe via System Events"
	script=$(
		cat <<OSASCRIPT
tell application "System Events"
  set probe to "Mirroring debug probe:"
  set appCount to count of application process
  set probe to (probe & "\n  applicationProcesses=" & appCount)

  set frontProcess to "unknown"
  try
    set frontProcess to (name of first process whose frontmost is true as text)
  end try
  set probe to (probe & "\n  frontmost=" & frontProcess)
  try
    set frontWindowCount to count of windows of first process whose frontmost is true
    set probe to (probe & "\n  frontmostWindowCount=" & frontWindowCount)
  end try

  repeat with p in every application process
    set pname to name of p
    if (pname contains "iPhone" or pname contains "Mirroring" or pname contains "QuickTime" or pname contains "Phone" or pname contains "AirPlay") then
      set probe to (probe & "\n  PROCESS: " & pname)
      try
        set processPid to id of p
        set probe to (probe & "\n    pid=" & processPid)
        set processWindowCount to count of windows of p
        set probe to (probe & "\n    WINDOWS: " & processWindowCount as text)
        repeat with w in windows of p
          try
            set wname to name of w as text
            set probe to (probe & "\n    - " & wname)
            try
              set b to bounds of w
              set probe to (probe & " | bounds=" & b as text)
            on error
              try
                set pxy to position of w
                set sz to size of w
                set probe to (probe & " | possize=(" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & ((item 1 of pxy + item 1 of sz) as text) & "," & ((item 2 of pxy + item 2 of sz) as text) & ")")
              on error
                set probe to (probe & " | bounds=<unreadable>")
              end try
            end try
          on error
            set probe to (probe & "\n    - <window metadata unavailable>")
          end try
        end repeat
      on error
        set probe to (probe & "\n    - <window list unavailable>")
      end try
    end if
  end repeat

  if (probe is "Mirroring debug probe:") then
    return "No matching iPhone/Mirroring/QuickTime processes found."
  end if

  return probe
end tell
OSASCRIPT
	)

	if out="$(osascript_eval "$script" 2>&1)"; then
		log_payload "Mirroring debug probe output" "$out"
		echo "$out" >&2
	else
		echo "Unable to query System Events process/window state." >&2
		echo "$out" >&2
	fi
}

log_bounds_payload() {
	local source="$1"
	local payload="$2"
	local mode
	local bounds

	mode="${payload#MODE=}"
	if [[ "$mode" == "$payload" ]]; then
		echo "$payload"
		return 0
	fi

	bounds="${mode#*|}"
	mode="${mode%%|*}"
	if ((PRINT_WINDOW_DEBUG)); then
		echo "AppleScript mode=${mode} source=${source} payload=${bounds}" >&2
	fi

	echo "$bounds"
}

query_process_bounds() {
	local process_name="$1"
	local script
	local out

	log_step "query_process_bounds: probing ${process_name}"
	script=$(
		cat <<OSASCRIPT
tell application "System Events"
  if not (exists application process "${process_name}") then
    return "NOAPP"
  end if

  tell application process "${process_name}"
    if (count of windows) is 0 then
      return "NOWINDOW"
    end if

    try
      set b to bounds of front window
      return "MODE=front-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
    on error
      try
        set pxy to position of front window
        set sz to size of front window
        return "MODE=front-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
      on error
        try
          set b to bounds of window 1
          return "MODE=window1-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
        on error
          try
            set pxy to position of window 1
            set sz to size of window 1
            return "MODE=window1-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
          on error
            return "NOBOUNDS"
          end try
        end try
      end try
    end try
  end tell
end tell
OSASCRIPT
	)

	if ! out="$(osascript_eval "$script" 2>&1)"; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "AppleScript query for '${process_name}' failed." >&2
			echo "$out" >&2
		fi
		return 1
	fi

	if [[ "$out" == *"execution error:"* ]]; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "AppleScript execution error while querying '${process_name}':" >&2
			echo "$out" >&2
		fi
		return 1
	fi

	log_payload "query_process_bounds raw output" "${process_name}: ${out}"

	if [[ "$out" == NOAPP || "$out" == NOWINDOW || "$out" == NOBOUNDS ]]; then
		log_step "query_process_bounds(${process_name}) returned '${out}'"
		echo "$out"
		return 0
	fi

	echo "$(log_bounds_payload "${process_name}" "$out")"
}

query_frontmost_window_bounds() {
	local script
	local out

	log_step "query_frontmost_window_bounds: probing frontmost window metadata"
	script=$(
		cat <<OSASCRIPT
tell application "System Events"
  set frontProc to (first process whose frontmost is true)
  set frontName to (name of frontProc as text)
  if (count of windows of frontProc) is 0 then
    return "NOWINDOW"
  end if

  try
    set b to bounds of front window of frontProc
    return "FRONT=" & frontName & "|MODE=front-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
  on error
    try
      set pxy to position of front window of frontProc
      set sz to size of front window of frontProc
      return "FRONT=" & frontName & "|MODE=front-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
    on error
      try
        set b to bounds of window 1 of frontProc
        return "FRONT=" & frontName & "|MODE=window1-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
      on error
        try
          set pxy to position of window 1 of frontProc
          set sz to size of window 1 of frontProc
          return "FRONT=" & frontName & "|MODE=window1-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
        on error
          return "NOBOUNDS"
        end try
      end try
    end try
  end try
end tell
OSASCRIPT
	)

	if ! out="$(osascript_eval "$script" 2>&1)"; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "AppleScript frontmost-window query failed." >&2
			echo "$out" >&2
		fi
		return 1
	fi

	if [[ "$out" == *"execution error:"* ]]; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "AppleScript execution error while querying frontmost window:" >&2
			echo "$out" >&2
		fi
		return 1
	fi

	log_payload "query_frontmost_window_bounds raw output" "$out"
	echo "$out"
}

scan_for_mirror_window_bounds() {
	local probe_output
	local candidate
	local candidate_out
	local proc_name
	local front_fields
	local front_mode
	local front_payload

	log_step "scan_for_mirror_window_bounds: checking configured host processes"

	for candidate in "$MIRROR_APP_NAME" "$MIRROR_APP_FALLBACK"; do
		if [[ -z "$candidate" ]]; then
			continue
		fi

		if ! candidate_out="$(query_process_bounds "$candidate")"; then
			if ((PRINT_WINDOW_DEBUG)); then
				echo "Skipping '${candidate}' during host scan because it could not be queried." >&2
			fi
			continue
		fi

		if [[ "$candidate_out" == "NOAPP" || "$candidate_out" == "NOWINDOW" || "$candidate_out" == "NOBOUNDS" ]]; then
			if ((PRINT_WINDOW_DEBUG)); then
				echo "Host '${candidate}' returned '${candidate_out}'." >&2
			fi
			continue
		fi

		if [[ "$candidate_out" == *"execution error:"* ]]; then
			if ((PRINT_WINDOW_DEBUG)); then
				echo "Host '${candidate}' execution error: ${candidate_out}" >&2
			fi
			continue
		fi

		if [[ "$candidate_out" =~ ^-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+$ ]]; then
			log_step "scan_for_mirror_window_bounds: usable bounds from '${candidate}'"
			printf "%s" "$candidate_out"
			return 0
		fi
	done

	log_step "scan_for_mirror_window_bounds: configured hosts unusable, checking frontmost process"
	if ! probe_output="$(query_frontmost_window_bounds)"; then
		echo "NO_MATCH"
		return 0
	fi

	if [[ "$probe_output" == "NOBOUNDS" || "$probe_output" == "NOWINDOW" ]]; then
		echo "NO_MATCH"
		return 0
	fi

	if [[ "$probe_output" == FRONT=* ]]; then
		proc_name="${probe_output%%|*}"
		front_fields="${probe_output#*|}"
		front_mode="${front_fields%%|*}"
		front_payload="${front_fields#*|}"
		proc_name="${proc_name#FRONT=}"
		front_mode="${front_mode#MODE=}"
		probe_output="$front_payload"
		log_step "Frontmost fallback identified '${proc_name}' using ${front_mode}"
		if [[ "$PRINT_WINDOW_DEBUG" -eq 1 ]]; then
			echo "Frontmost process '${proc_name}' used mode '${front_mode}' => bounds ${probe_output}" >&2
		fi
	fi

	if [[ "$probe_output" == *","* ]]; then
		printf "%s" "$probe_output"
		return 0
	fi

	echo "NO_MATCH"
	return 0
}

sanitize_query_for_filename() {
	local raw="${1:-query}"
	local slug

	slug="$(printf "%s" "$raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | sed 's/^_//; s/_$//; s/__*/_/g')"

	if [[ -z "$slug" ]]; then
		slug="query"
	fi

	printf "%s" "$slug"
}

# Returns comma-separated bounds: "x1,y1,x2,y2"
get_mirror_window_bounds() {
	local script
	local out
	local fallback_out

	log_step "get_mirror_window_bounds: querying '${MIRROR_APP_NAME}' as primary host"
	# Prefer the explicit iPhone Mirroring process name.
	script=$(
		cat <<OSASCRIPT
tell application "System Events"
  if not (exists application process "iPhone Mirroring") then
    return "NOAPP"
  end if

  tell application process "iPhone Mirroring"
    if (count of windows) is 0 then
      return "NOWINDOW"
    end if

    try
      set b to bounds of front window
      return (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
    on error
      try
        set b to bounds of window 1
        return (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
      on error
        return "NOBOUNDS"
      end try
    end try
  end tell
end tell
OSASCRIPT
	)

	if ! out="$(osascript_eval "$script" 2>&1)"; then
		echo "AppleScript call failed. Ensure Accessibility and Automation permissions include your terminal app." >&2
		return 1
	fi

	log_payload "get_mirror_window_bounds primary output" "$out"

	if [[ "$out" == *"execution error:"* ]]; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "AppleScript execution error while querying iPhone Mirroring:" >&2
			echo "$out" >&2
		fi
		fail_with_connection_hint "AppleScript could not read iPhone Mirroring bounds. Ensure the mirroring session is connected and visible." || return 1
	fi

	case "$out" in
	"NOWINDOW")
		if ((PRINT_WINDOW_DEBUG)); then
			echo "iPhone Mirroring exists but has no accessible windows. Trying broader host scan..." >&2
		fi
		;;
	"NOBOUNDS")
		if ((PRINT_WINDOW_DEBUG)); then
			echo "iPhone Mirroring returned no readable bounds. Trying broader host scan..." >&2
		fi
		;;
	esac

	if ! [[ "$out" =~ ^-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+$ ]]; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "Mirroring probe for non-numeric bounds output (${out}):" >&2
			print_mirror_debug_probe
		fi

		if ! fallback_out="$(scan_for_mirror_window_bounds)"; then
			fail_with_connection_hint "Could not scan System Events for a mirrored window." || return 1
		fi

		if [[ "$fallback_out" == "NO_MATCH" ]]; then
			if ((PRINT_WINDOW_DEBUG)); then
				echo "No host window candidate found during broad host scan." >&2
			fi
			fail_with_connection_hint "Could not find a mirrored host process/window to read bounds from. Try reopening iPhone Mirroring." || return 1
		fi

		out="$fallback_out"
		log_step "get_mirror_window_bounds: using fallback source '${fallback_out}'"
	fi

	if ! [[ "$out" =~ ^-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+$ ]]; then
		if ((PRINT_WINDOW_DEBUG)); then
			echo "Unable to parse a usable bounding rectangle from: '${out}'" >&2
		fi
		echo "Unexpected bounds output from AppleScript: '${out}'" >&2
		return 1
	fi

	printf "%s" "$out"
}

focus_mirroring() {
	local candidate
	log_step "focus_mirroring: attempting to activate a mirroring host window"
	for candidate in "$MIRROR_APP_NAME" "$MIRROR_APP_FALLBACK"; do
		if [[ -z "$candidate" ]]; then
			continue
		fi
		log_step "focus_mirroring: trying '${candidate}'"
		if osascript_eval "tell application \"${candidate}\" to activate" >/dev/null 2>&1; then
			log_step "focus_mirroring: activated '${candidate}'"
			return
		fi
	done

	die_with_connection_hint "Could not activate a mirroring host application."
}

get_content_region() {
	local bounds
	local x1 y1 x2 y2

	if [[ $# -gt 0 ]]; then
		bounds="$1"
	else
		if ! bounds="$(get_mirror_window_bounds)"; then
			return 1
		fi
	fi

	if [[ -z "$bounds" ]]; then
		die "Mirroring bounds were empty."
	fi

	IFS=',' read -r x1 y1 x2 y2 <<<"$bounds"

	local win_w=$((x2 - x1))
	local win_h=$((y2 - y1))
	if ((win_w <= 0 || win_h <= 0)); then
		die "Invalid mirroring window bounds: x1=$x1 y1=$y1 x2=$x2 y2=$y2"
	fi

	local cx=$((x1 + INSET_LEFT))
	local cy=$((y1 + INSET_TOP))
	local cw=$((win_w - INSET_LEFT - INSET_RIGHT))
	local ch=$((win_h - INSET_TOP - INSET_BOTTOM))

	if ((cw <= 0 || ch <= 0)); then
		die "Invalid content region after applying insets."
	fi

	if ! [[ "$COORD_SCALE" =~ ^[0-9]+$ ]] || ((COORD_SCALE < 1)); then
		die "COORD_SCALE must be a positive integer (1 or greater)."
	fi

	cx=$((cx * COORD_SCALE))
	cy=$((cy * COORD_SCALE))
	cw=$((cw * COORD_SCALE))
	ch=$((ch * COORD_SCALE))

	echo "$cx $cy $cw $ch"
}

rel_to_abs() {
	local rx="$1"
	local ry="$2"
	local cx cy cw ch ax ay
	local region

	if ! region="$(get_content_region)"; then
		return 1
	fi

	IFS=' ' read -r cx cy cw ch <<<"$region"

	awk -v cx="$cx" -v cy="$cy" -v cw="$cw" -v ch="$ch" -v rx="$rx" -v ry="$ry" '
		BEGIN {
			x = cx + (cw * rx)
			y = cy + (ch * ry)
			printf "%.0f %.0f", x, y
		}
	'
}

abs_to_rel() {
	local ax="$1"
	local ay="$2"
	local cx cy cw ch
	local region

	if ! region="$(get_content_region)"; then
		return 1
	fi

	IFS=' ' read -r cx cy cw ch <<<"$region"

	awk -v cx="$cx" -v cy="$cy" -v cw="$cw" -v ch="$ch" -v ax="$ax" -v ay="$ay" '
    BEGIN {
      printf "%.6f %.6f\n", (ax - cx) / cw, (ay - cy) / ch
    }
  '
}

click_rel() {
	local rx="$1"
	local ry="$2"
	local ax ay
	local point

	point="$(rel_to_abs "$rx" "$ry")" || return 1
	read -r ax ay <<<"$point"
	rx="$(printf "%s" "$rx" | tr -d '[:space:],')"
	ry="$(printf "%s" "$ry" | tr -d '[:space:],')"
	ax="$(printf "%s" "$ax" | tr -d '[:space:],')"
	ay="$(printf "%s" "$ay" | tr -d '[:space:],')"

	if [[ -z "$ax" || -z "$ay" || ! "$ax" =~ ^-?[0-9]+$ || ! "$ay" =~ ^-?[0-9]+$ ]]; then
		die "Invalid click coordinates for rel (${rx}, ${ry}) => abs (${ax}, ${ay})"
	fi
	log_step "click_rel: absolute target ${ax},${ay} from rel ${rx},${ry}"
	cliclick "c:${ax},${ay}" >/dev/null
}

drag_rel() {
	local start_rx="$1"
	local start_ry="$2"
	local end_rx="$3"
	local end_ry="$4"

	local sx sy ex ey
	local start_point end_point

	start_point="$(rel_to_abs "$start_rx" "$start_ry")" || return 1
	end_point="$(rel_to_abs "$end_rx" "$end_ry")" || return 1
	read -r sx sy <<<"$start_point"
	read -r ex ey <<<"$end_point"
	sx="$(printf "%s" "$sx" | tr -d '[:space:],')"
	sy="$(printf "%s" "$sy" | tr -d '[:space:],')"
	ex="$(printf "%s" "$ex" | tr -d '[:space:],')"
	ey="$(printf "%s" "$ey" | tr -d '[:space:],')"

	if [[ -z "$sx" || -z "$sy" || -z "$ex" || -z "$ey" || ! "$sx" =~ ^-?[0-9]+$ || ! "$sy" =~ ^-?[0-9]+$ || ! "$ex" =~ ^-?[0-9]+$ || ! "$ey" =~ ^-?[0-9]+$ ]]; then
		die "Invalid drag coordinates: ${start_rx},${start_ry} => ${end_rx},${end_ry} produced ${sx},${sy} => ${ex},${ey}"
	fi

	log_step "drag_rel: absolute start ${sx},${sy} end ${ex},${ey}"

	cliclick "dd:${sx},${sy}" "m:${ex},${ey}" "du:${ex},${ey}" >/dev/null
}

tap_sequence() {
	local steps="$1"
	local IFS=';'
	local step
	local rx ry

	for step in $steps; do
		[[ -z "$step" ]] && continue
		rx="${step%,*}"
		ry="${step#*,}"
		click_rel "$rx" "$ry"
		sleep 0.15
	done
}

clear_field() {
	case "$CLEAR_MODE" in
	select_all)
		cliclick "kp:cmd-a" "kp:delete" >/dev/null
		;;
	backspace:*)
		local count
		count="${CLEAR_MODE#backspace:}"
		if ! [[ "$count" =~ ^[0-9]+$ ]]; then
			die "Invalid CLEAR_MODE backspace count: ${count}"
		fi
		local i=0
		while ((i < count)); do
			cliclick "kp:delete" >/dev/null
			i=$((i + 1))
		done
		;;
	*)
		die "Unknown CLEAR_MODE: ${CLEAR_MODE}"
		;;
	esac
}

screenshot_content() {
	local out="$1"
	local cx cy cw ch
	local region

	if ! region="$(get_content_region)"; then
		return 1
	fi

	IFS=' ' read -r cx cy cw ch <<<"$region"
	mkdir -p "$(dirname "$out")"
	screencapture -x -R "${cx},${cy},${cw},${ch}" "$out"
}

go_home_best_effort() {
	cliclick "kp:cmd-h" >/dev/null || true
	sleep 0.4
	drag_rel 0.50 0.96 0.50 0.55 || true
	sleep 0.4
}

open_app_from_home() {
	local icon_rx="$1"
	local icon_ry="$2"

	go_home_best_effort
	click_rel "$icon_rx" "$icon_ry"
	sleep "$APP_OPEN_DELAY_SEC"
}

escape_tap_text() {
	local ch="$1"
	ch="${ch//\\/\\\\}"
	ch="${ch//,/\\,}"
	ch="${ch//:/\\:}"
	printf "%s" "$ch"
}

type_and_capture_per_char() {
	local app="$1"
	local query="$2"
	local outdir="$3"
	local query_slug="$4"

	mkdir -p "$outdir"
	local len="${#query}"
	local i=0
	local prefix
	local ch
	local encoded
	local out

	screenshot_content "${outdir}/${app}_00_empty_${query_slug}.png"

	while ((i < len)); do
		ch="${query:i:1}"
		encoded="$(escape_tap_text "$ch")"
		cliclick "t:${encoded}" >/dev/null
		sleep "$CHAR_DELAY_SEC"

		prefix="$(printf "%02d" $((i + 1)))"
		out="${outdir}/${app}_${prefix}_${query_slug}.png"
		screenshot_content "$out"

		i=$((i + 1))
	done
}

run_app_flow() {
	local app="$1"
	local query="$2"
	local outbase="$3"
	local query_slug="$4"
	local app_dir="${outbase}/${app}"

	focus_mirroring
	sleep 0.2

	case "$app" in
	chrome)
		open_app_from_home "$CHROME_ICON_RX" "$CHROME_ICON_RY"
		tap_sequence "$CHROME_SEARCH_STEPS"
		clear_field
		type_and_capture_per_char "chrome" "$query" "$app_dir" "$query_slug"
		;;
	instagram)
		open_app_from_home "$INSTAGRAM_ICON_RX" "$INSTAGRAM_ICON_RY"
		tap_sequence "$INSTAGRAM_SEARCH_STEPS"
		clear_field
		type_and_capture_per_char "instagram" "$query" "$app_dir" "$query_slug"
		;;
	tiktok)
		open_app_from_home "$TIKTOK_ICON_RX" "$TIKTOK_ICON_RY"
		tap_sequence "$TIKTOK_SEARCH_STEPS"
		clear_field
		type_and_capture_per_char "tiktok" "$query" "$app_dir" "$query_slug"
		;;
	*)
		die "Unknown app: ${app}"
		;;
	esac
}

QUERY=""
APPS=""
OUTDIR=""

if [[ $# -eq 0 ]]; then
	usage
	exit 1
fi

while [[ $# -gt 0 ]]; do
	case "$1" in
	--query)
		if [[ $# -lt 2 ]]; then
			die "--query requires a value"
		fi
		QUERY="${2:-}"
		shift 2
		;;
	--apps)
		if [[ $# -lt 2 ]]; then
			die "--apps requires a value"
		fi
		APPS="${2:-}"
		shift 2
		;;
	--out)
		if [[ $# -lt 2 ]]; then
			die "--out requires a value"
		fi
		OUTDIR="${2:-}"
		shift 2
		;;
	--print-window)
		log_step "Entering print-window diagnostics mode"
		need_cmd osascript "This command is built into macOS."
		need_cmd awk "This command is built into macOS."
		need_cmd cliclick "brew install cliclick"
		need_cmd screencapture "This command is built into macOS."

		focus_mirroring
		if ! mirror_bounds="$(get_mirror_window_bounds)"; then
			exit 1
		fi
		if ! content_bounds="$(get_content_region "${mirror_bounds}")"; then
			exit 1
		fi
		log_step "Computed window/content bounds successfully for diagnostics"
		echo "window: ${mirror_bounds}"
		echo "content: ${content_bounds}"
		exit 0
		;;
	--calibrate)
		log_step "Entering calibrate mode"
		need_cmd osascript "This command is built into macOS."
		need_cmd awk "This command is built into macOS."
		need_cmd cliclick "brew install cliclick"
		need_cmd screencapture "This command is built into macOS."

		focus_mirroring
		mkdir -p "./calibration"
		screenshot_content "./calibration/iphone_content.png"
		echo "Wrote ./calibration/iphone_content.png"
		exit 0
		;;
	--coord-to-rel)
		if [[ $# -lt 3 ]]; then
			die "--coord-to-rel requires X and Y"
		fi
		need_cmd osascript "This command is built into macOS."
		need_cmd awk "This command is built into macOS."
		abs_to_rel "$2" "$3"
		exit 0
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		die "Unknown argument: $1"
		;;
	esac
done

if [[ -z "$QUERY" ]]; then
	die "Missing --query"
fi

if [[ -z "$APPS" ]]; then
	die "Missing --apps"
fi

need_cmd osascript "This command is built into macOS."
need_cmd awk "This command is built into macOS."
need_cmd cliclick "brew install cliclick"
need_cmd screencapture "This command is built into macOS."

if [[ -z "$QUERY" ]]; then
	die "Query must not be empty"
fi

if [[ -z "$OUTDIR" ]]; then
	ts="$(date +"%Y%m%d_%H%M%S")"
	OUTDIR="./autofill_shots_${ts}"
fi

mkdir -p "$OUTDIR"

query_slug="$(sanitize_query_for_filename "$QUERY")"
app_specs=(${APPS//,/ })

for app_spec in "${app_specs[@]}"; do
	app="$(trim "$app_spec" | tr '[:upper:]' '[:lower:]')"
	case "$app" in
	chrome | instagram | tiktok)
		run_app_flow "$app" "$QUERY" "$OUTDIR" "$query_slug"
		;;
	*)
		die "Unknown app '${app}'. Use chrome,instagram,tiktok."
		;;
	esac
done

echo "Done. Output: ${OUTDIR}"

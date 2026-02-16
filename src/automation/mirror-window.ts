import { asCommandResult, runOsa } from "./command-bridge";
import { MIRROR_APP_FALLBACK, MIRROR_APP_NAME, PRINT_WINDOW_DEBUG, failWithConnectionHint, logPayload, logStep, die, trim } from "../utils";
import { numericBoundsPayload } from "./geometry";

export function queryProcessBounds(this: { runOsa?: (value: string) => string }, processName: string): string {
	const script = `
\ttell application "System Events"
\t  if not (exists application process "${processName}") then
\t    return "NOAPP"
\t  end if
\n\t  tell application process "${processName}"
\t    if (count of windows) is 0 then
\t      return "NOWINDOW"
\t    end if
\n\t    try
\t      set b to bounds of front window
\t      return "MODE=front-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t    on error
\t      try
\t        set pxy to position of front window
\t        set sz to size of front window
\t        return "MODE=front-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
\t      on error
\t        try
\t          set b to bounds of window 1
\t          return "MODE=window1-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t        on error
\t          try
\t            set pxy to position of window 1
\t            set sz to size of window 1
\t            return "MODE=window1-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
\t          on error
\t            return "NOBOUNDS"
\t          end try
\t        end try
\t      end try
\t    end try
\t  end tell
\tend tell
\t`.trim();
	const out = runOsa(script);
	logPayload("query_process_bounds raw output", `${processName}: ${out}`);
	if (out === "NOAPP" || out === "NOWINDOW" || out === "NOBOUNDS") {
		logStep(`query_process_bounds(${processName}) returned '${out}'`);
		return out;
	}
	if (!out.includes("MODE=")) {
		return out;
	}
	return logBoundsPayload.call(this, processName, out);
}

export function queryFrontmostWindowBounds(): string {
	const script = `
\ttell application "System Events"
\t  set frontProc to (first process whose frontmost is true)
\t  set frontName to (name of frontProc as text)
\t  if (count of windows of frontProc) is 0 then
\t    return "NOWINDOW"
\t  end if
\n\t  try
\t    set b to bounds of front window of frontProc
\t    return "FRONT=" & frontName & "|MODE=front-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t  on error
\t    try
\t      set pxy to position of front window of frontProc
\t      set sz to size of front window of frontProc
\t      return "FRONT=" & frontName & "|MODE=front-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
\t    on error
\t      try
\t        set b to bounds of window 1 of frontProc
\t        return "FRONT=" & frontName & "|MODE=window1-bounds|" & (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t      on error
\t        try
\t          set pxy to position of window 1 of frontProc
\t          set sz to size of window 1 of frontProc
\t          return "FRONT=" & frontName & "|MODE=window1-possize|" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & (item 1 of pxy + item 1 of sz as text) & "," & (item 2 of pxy + item 2 of sz as text)
\t        on error
\t          return "NOBOUNDS"
\t        end try
\t      end try
\t    end try
\t  end try
\tend tell
\t`.trim();
	const out = runOsa(script);
	logPayload("query_frontmost_window_bounds raw output", out);
	return out;
}

export function logBoundsPayload(source: string, payload: string): string {
	const modeAndPayload = payload.substring(payload.indexOf("MODE=") + 5);
	const mode = modeAndPayload.includes("|") ? modeAndPayload.substring(0, modeAndPayload.indexOf("|")) : modeAndPayload;
	const bounds = modeAndPayload.includes("|") ? modeAndPayload.substring(modeAndPayload.indexOf("|") + 1) : "";
	if (PRINT_WINDOW_DEBUG) {
		console.error(`AppleScript mode=${mode} source=${source} payload=${bounds}`);
	}
	return bounds;
}

export function printMirrorDebugProbe(): void {
	const script = `
\ttell application "System Events"
\t  set probe to "Mirroring debug probe:"
\t  set appCount to count of application process
\t  set probe to (probe & "\n  applicationProcesses=" & appCount)
\n\t  set frontProcess to "unknown"
\t  try
\t    set frontProcess to (name of first process whose frontmost is true as text)
\t  end try
\t  set probe to (probe & "\n  frontmost=" & frontProcess)
\t  try
\t    set frontWindowCount to count of windows of first process whose frontmost is true
\t    set probe to (probe & "\n  frontmostWindowCount=" & frontWindowCount)
\t  end try
\n\t  repeat with p in every application process
\t    set pname to name of p
\t    if (pname contains "iPhone" or pname contains "Mirroring" or pname contains "QuickTime" or pname contains "Phone" or pname contains "AirPlay") then
\t      set probe to (probe & "\n  PROCESS: " & pname)
\t      try
\t        set processPid to id of p
\t        set probe to (probe & "\n    pid=" & processPid)
\t        set processWindowCount to count of windows of p
\t        set probe to (probe & "\n    WINDOWS: " & processWindowCount as text)
\t        repeat with w in windows of p
\t          try
\t            set wname to name of w as text
\t            set probe to (probe & "\n    - " & wname)
\t            try
\t              set b to bounds of w
\t              set probe to (probe & " | bounds=" & b as text)
\t            on error
\t              try
\t                set pxy to position of w
\t                set sz to size of w
\t                set probe to (probe & " | possize=(" & (item 1 of pxy as text) & "," & (item 2 of pxy as text) & "," & ((item 1 of pxy + item 1 of sz) as text) & "," & ((item 2 of pxy + item 2 of sz) as text) & ")")
\t              on error
\t                set probe to (probe & " | bounds=<unreadable>")
\t              end try
\t            end try
\t          on error
\t            set probe to (probe & "\n    - <window metadata unavailable>")
\t          end try
\t        end repeat
\t      on error
\t        set probe to (probe & "\n    - <window list unavailable>")
\t      end try
\t    end if
\t  end repeat
\n\t  if (probe is "Mirroring debug probe:") then
\t    return "No matching iPhone/Mirroring/QuickTime processes found."
\t  end if
\n\t  return probe
\tend tell
\t`.trim();

	const result = asCommandResult("osascript", ["-e", script]);
	if (result.exitCode !== 0) {
		console.error("Unable to query System Events process/window state.");
		console.error(trim(result.output));
		return;
	}
	console.error(trim(result.output));
}

export function scanForMirrorWindowBounds(this: { queryProcessBounds: (processName: string) => string; queryFrontmostWindowBounds: () => string }, silent = false): string {
	if (!silent) {
		logStep("scan_for_mirror_window_bounds: checking configured host processes");
	}

	for (const candidate of [MIRROR_APP_NAME, MIRROR_APP_FALLBACK]) {
		if (!candidate) continue;
		let candidateOut = "";
		try {
			candidateOut = this.queryProcessBounds(candidate);
		} catch {
			if (PRINT_WINDOW_DEBUG) {
				console.error(`Skipping '${candidate}' during host scan because it could not be queried.`);
			}
			continue;
		}

		if (candidateOut === "NOAPP" || candidateOut === "NOWINDOW" || candidateOut === "NOBOUNDS") {
			if (PRINT_WINDOW_DEBUG) {
				console.error(`Host '${candidate}' returned '${candidateOut}'.`);
			}
			continue;
		}
		if (numericBoundsPayload(candidateOut)) {
			if (!silent) {
				logStep(`scan_for_mirror_window_bounds: usable bounds from '${candidate}'`);
			}
			return candidateOut;
		}
	}

	if (!silent) {
		logStep("scan_for_mirror_window_bounds: configured hosts unusable, checking frontmost process");
	}
	let probeOutput = "";
	try {
		probeOutput = this.queryFrontmostWindowBounds();
	} catch {
		return "NO_MATCH";
	}
	if (probeOutput === "NOBOUNDS" || probeOutput === "NOWINDOW") {
		return "NO_MATCH";
	}
	if (probeOutput.startsWith("FRONT=")) {
		const fields = probeOutput.split("|");
		const procName = fields[0] ? fields[0].replace("FRONT=", "") : "";
		const frontMode = fields[1] ? fields[1].replace("MODE=", "") : "";
		const bounds = fields.slice(2).join("|");
		if (PRINT_WINDOW_DEBUG) {
			console.error(`Frontmost process '${procName}' used mode '${frontMode}' => bounds ${bounds}`);
		}
		if (numericBoundsPayload(bounds)) {
			if (!silent) {
				logStep(`Frontmost fallback identified '${procName}' using ${frontMode}`);
			}
			return bounds;
		}
	}
	return "NO_MATCH";
}

export function getMirrorWindowBounds(this: {
	scanForMirrorWindowBounds: () => string;
	printMirrorDebugProbe: () => void;
}): string {
	logStep(`get_mirror_window_bounds: querying '${MIRROR_APP_NAME}' as primary host`);
	const script = `
\ttell application "System Events"
\t  if not (exists application process "${MIRROR_APP_NAME}") then
\t    return "NOAPP"
\t  end if
\n\t  tell application process "${MIRROR_APP_NAME}"
\t    if (count of windows) is 0 then
\t      return "NOWINDOW"
\t    end if
\n\t    try
\t      set b to bounds of front window
\t      return (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t    on error
\t      try
\t        set b to bounds of window 1
\t        return (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
\t      on error
\t        return "NOBOUNDS"
\t      end try
\t    end try
\t  end tell
\tend tell
\t`.trim();

	let out = runOsa(script);
	logPayload("get_mirror_window_bounds primary output", out);
	if (out.includes("execution error:") || !out.length) {
		if (PRINT_WINDOW_DEBUG) {
			console.error("AppleScript execution error while querying iPhone Mirroring:");
			console.error(out);
		}
		failWithConnectionHint("AppleScript could not read iPhone Mirroring bounds. Ensure the mirroring session is connected and visible.");
	}
	if (out === "NOWINDOW" || out === "NOBOUNDS") {
		logStep("Attempting fallback host scan for mirroring bounds.");
	}
	if (!numericBoundsPayload(out)) {
		if (PRINT_WINDOW_DEBUG) {
			console.error(`Mirroring probe for non-numeric bounds output (${out}):`);
			this.printMirrorDebugProbe();
		}
		const fallbackOut = this.scanForMirrorWindowBounds();
		if (fallbackOut === "NO_MATCH") {
			if (PRINT_WINDOW_DEBUG) {
				console.error("No host window candidate found during broad host scan.");
			}
			failWithConnectionHint("Could not find a mirrored host process/window to read bounds from. Try reopening iPhone Mirroring.");
		}
		out = fallbackOut;
		logStep(`get_mirror_window_bounds: using fallback source '${out}'`);
	}
	if (!numericBoundsPayload(out)) {
		die(`Unexpected bounds output from AppleScript: '${out}'`);
	}
	return out;
}

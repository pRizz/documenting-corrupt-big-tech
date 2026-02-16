import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
	APP_OPEN_DELAY_SEC,
	BACKSPACE_COUNT,
	CHROME_ICON_RX,
	CHROME_ICON_RY,
	CHROME_SEARCH_STEPS,
	CLEAR_MODE,
	CHAR_DELAY_SEC,
	COORD_SCALE,
	INSET_BOTTOM,
	INSET_LEFT,
	INSET_RIGHT,
	INSET_TOP,
	INSTAGRAM_ICON_RX,
	INSTAGRAM_ICON_RY,
	INSTAGRAM_SEARCH_STEPS,
	LOG_PREFIX,
	MIRROR_APP_FALLBACK,
	MIRROR_APP_NAME,
	PRINT_WINDOW_DEBUG,
	TIKTOK_ICON_RX,
	TIKTOK_ICON_RY,
	TIKTOK_SEARCH_STEPS,
	Region,
	RELATIVE_TOKEN_RE,
	SupportedApp,
	sleep,
	trim,
	sanitizeQueryForFilename,
	timestampSnapshot,
	WindowBounds,
	die,
	failWithConnectionHint,
	logPayload,
	logStep,
} from "./utils";

export const SUPPORTED_APPS: ReadonlyArray<SupportedApp> = ["chrome", "instagram", "tiktok"];

function asCommandResult(command: string, args: string[]): { exitCode: number; output: string } {
	const proc = Bun.spawnSync([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = proc.stdout ? proc.stdout.toString() : "";
	const stderr = proc.stderr ? proc.stderr.toString() : "";
	return { exitCode: proc.exitCode, output: `${stdout}${stderr}` };
}

function needCmd(cmd: string, hint = ""): void {
	if (!Bun.which(cmd)) {
		die(hint ? `Missing required command: ${cmd}. ${hint}` : `Missing required command: ${cmd}.`);
	}
}

function runOsa(script: string): string {
	const result = asCommandResult("osascript", ["-e", script]);
	if (result.exitCode !== 0) {
		if (result.output.length > 0) {
			logPayload("osascript output", trim(result.output));
		}
		die("AppleScript call failed. Ensure Accessibility and Automation permissions include your terminal app.");
	}
	return trim(result.output);
}

function numericBoundsPayload(raw: string): boolean {
	return /^-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+$/.test(trim(raw));
}

function parseBoundsTuple(raw: string): WindowBounds {
	const values = raw.split(",").map((value) => Number(trim(value)));
	if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
		die(`Could not parse bounds payload '${raw}'.`);
	}
	const [x1, y1, x2, y2] = values;
	return { x1, y1, x2, y2 };
}

function validateRelativeToken(label: string, value: string): number {
	const normalized = trim(value);
	if (normalized.length === 0) {
		die(`Invalid relative token for ${label}: empty`);
	}
	if (!RELATIVE_TOKEN_RE.test(normalized)) {
		die(`Invalid relative token for ${label}: '${value}'`);
	}
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed)) {
		die(`Invalid relative token for ${label}: '${value}'`);
	}
	return parsed;
}

function escapeTapText(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/:/g, "\\:");
}

export class AutofillAutomation {
	private getFrontmostProcess(): string {
		const script = `
	tell application "System Events"
	  try
	    return (name of first process whose frontmost is true as text)
	  on error
	    return "unknown"
	  end try
	end tell
	`.trim();

		try {
			return runOsa(script);
		} catch {
			return "unknown";
		}
	}

	private logFrontmostState(phase: string): void {
		const frontProcess = this.getFrontmostProcess();
		logStep(`frontmost(${phase}): ${frontProcess}`);
		if (frontProcess !== MIRROR_APP_NAME && frontProcess !== MIRROR_APP_FALLBACK) {
			return;
		}

		try {
			const bounds = this.scanForMirrorWindowBounds(true);
			if (bounds === "NO_MATCH") {
				logStep(`frontmost(${phase}): mirror bounds unavailable`);
			} else {
				logStep(`frontmost(${phase}): mirror bounds ${bounds}`);
			}
		} catch {
			logStep(`frontmost(${phase}): mirror bounds unavailable`);
		}
	}

	private focusMirroring(): void {
		this.logFrontmostState("before-focus");
		for (const candidate of [MIRROR_APP_NAME, MIRROR_APP_FALLBACK]) {
			if (!candidate) continue;
			logStep(`focus_mirroring: trying '${candidate}'`);
			const result = asCommandResult("osascript", ["-e", `tell application "${candidate}" to activate`]);
			if (result.exitCode === 0) {
				this.logFrontmostState(`after-focus-${candidate}`);
				return;
			}
		}
		failWithConnectionHint("Could not activate a mirroring host application.");
	}

	private async ensureMirrorFrontmost(phase: string): Promise<boolean> {
		for (let attempt = 1; attempt <= 6; attempt += 1) {
			const frontProcess = this.getFrontmostProcess();
			logStep(`ensure_mirror_frontmost(${phase}): attempt ${attempt}/6 frontmost=${frontProcess}`);
			if (frontProcess === MIRROR_APP_NAME || frontProcess === MIRROR_APP_FALLBACK) {
				return true;
			}

			this.focusMirroring();
			await sleep(0.15);
		}

		const frontProcess = this.getFrontmostProcess();
		logStep(`ensure_mirror_frontmost(${phase}): failed, final frontmost=${frontProcess}`);
		return false;
	}

	private async sendHostKeystroke(keyText: string, modifiersRaw = "", context = "keystroke"): Promise<boolean> {
		if (!keyText) {
			die(`send_host_keystroke(${context}) requires a key text`);
		}

		if (!(await this.ensureMirrorFrontmost(context))) {
			logStep(`send_host_keystroke(${context}): mirror host was not frontmost`);
			return false;
		}

		const escaped = keyText.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
		const modifierTokens = trim(modifiersRaw)
			.split(",")
			.map(trim)
			.filter((token) => token.length > 0);
		const modifierStatements: string[] = [];
		for (const token of modifierTokens) {
			switch (token.toLowerCase()) {
				case "command":
				case "cmd":
				case "commanddown":
					modifierStatements.push("command down");
					break;
				case "control":
				case "ctrl":
					modifierStatements.push("control down");
					break;
				case "option":
				case "alt":
				case "optiondown":
					modifierStatements.push("option down");
					break;
				case "shift":
					modifierStatements.push("shift down");
					break;
				default:
					die(`Unsupported modifier token '${token}' in send_host_keystroke(${context})`);
			}
		}

		const modifierPayload = modifierStatements.join(", ");
		const script = modifierPayload
			? `tell application "System Events" to keystroke "${escaped}" using {${modifierPayload}}`
			: `tell application "System Events" to keystroke "${escaped}"`;

		try {
			runOsa(script);
		} catch {
			logStep(`send_host_keystroke(${context}): key event failed`);
			return false;
		}

		if (!(await this.ensureMirrorFrontmost(`${context}:post`))) {
			this.focusMirroring();
			await sleep(0.1);
			if (!(await this.ensureMirrorFrontmost(`${context}:post-retry`))) {
				die(`Could not return mirroring host to frontmost after keystroke.`);
			}
		}

		logStep(`send_host_keystroke(${context}): sent '${keyText}' with modifiers='${modifierPayload}'`);
		return true;
	}

	private runCliclick(payload: string): void {
		const result = asCommandResult("cliclick", [payload]);
		if (result.exitCode !== 0) {
			die(`cliclick command failed for '${payload}': ${trim(result.output)}`);
		}
	}

	private queryProcessBounds(processName: string): string {
		const script = `
	tell application "System Events"
	  if not (exists application process "${processName}") then
	    return "NOAPP"
	  end if

	  tell application process "${processName}"
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
	`.trim();

		const out = runOsa(script);
		logPayload("query_process_bounds raw output", `${processName}: ${out}`);
		if (out === "NOAPP" || out === "NOWINDOW" || out === "NOBOUNDS") {
			logStep(`query_process_bounds(${processName}) returned '${out}'`);
			return out;
		}
		if (!out.includes("MODE=")) {
			return out;
		}
		return this.logBoundsPayload(processName, out);
	}

	private queryFrontmostWindowBounds(): string {
		const script = `
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
	`.trim();

		const out = runOsa(script);
		logPayload("query_frontmost_window_bounds raw output", out);
		return out;
	}

	private logBoundsPayload(source: string, payload: string): string {
		const modeAndPayload = payload.substring(payload.indexOf("MODE=") + 5);
		const mode = modeAndPayload.includes("|") ? modeAndPayload.substring(0, modeAndPayload.indexOf("|")) : modeAndPayload;
		const bounds = modeAndPayload.includes("|") ? modeAndPayload.substring(modeAndPayload.indexOf("|") + 1) : "";
		if (PRINT_WINDOW_DEBUG) {
			console.error(`AppleScript mode=${mode} source=${source} payload=${bounds}`);
		}
		return bounds;
	}

	private printMirrorDebugProbe(): void {
		const script = `
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
	`.trim();

		const result = asCommandResult("osascript", ["-e", script]);
		if (result.exitCode !== 0) {
			console.error("Unable to query System Events process/window state.");
			console.error(trim(result.output));
			return;
		}
		console.error(trim(result.output));
	}

	private scanForMirrorWindowBounds(silent = false): string {
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
			const procName = fields[0]?.replace("FRONT=", "") ?? "";
			const frontMode = fields[1]?.replace("MODE=", "") ?? "";
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

	private getMirrorWindowBounds(): string {
		logStep(`get_mirror_window_bounds: querying '${MIRROR_APP_NAME}' as primary host`);
		const script = `
	tell application "System Events"
	  if not (exists application process "${MIRROR_APP_NAME}") then
	    return "NOAPP"
	  end if

	  tell application process "${MIRROR_APP_NAME}"
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
	`.trim();

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

	private getContentRegion(bounds?: string): Region {
		const mirrorBounds = bounds ? trim(bounds) : this.getMirrorWindowBounds();
		if (mirrorBounds.length === 0) {
			die("Mirroring bounds were empty.");
		}
		const parsed = parseBoundsTuple(mirrorBounds);
		const windowWidth = parsed.x2 - parsed.x1;
		const windowHeight = parsed.y2 - parsed.y1;
		if (windowWidth <= 0 || windowHeight <= 0) {
			die(`Invalid mirroring window bounds: x1=${parsed.x1} y1=${parsed.y1} x2=${parsed.x2} y2=${parsed.y2}`);
		}

		let contentX = parsed.x1 + INSET_LEFT;
		let contentY = parsed.y1 + INSET_TOP;
		let contentWidth = windowWidth - INSET_LEFT - INSET_RIGHT;
		let contentHeight = windowHeight - INSET_TOP - INSET_BOTTOM;
		if (contentWidth <= 0 || contentHeight <= 0) {
			die("Invalid content region after applying insets.");
		}
		if (!Number.isInteger(COORD_SCALE) || COORD_SCALE < 1) {
			die("COORD_SCALE must be a positive integer (1 or greater).");
		}

		return {
			x: contentX * COORD_SCALE,
			y: contentY * COORD_SCALE,
			width: contentWidth * COORD_SCALE,
			height: contentHeight * COORD_SCALE,
		};
	}

	private relToAbs(rx: number, ry: number): [number, number] {
		const region = this.getContentRegion();
		logPayload("rel_to_abs region", `x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);
		const x = region.x + region.width * rx;
		const y = region.y + region.height * ry;
		const absX = Math.round(x);
		const absY = Math.round(y);
		if (!Number.isInteger(absX) || !Number.isInteger(absY)) {
			die(`rel_to_abs produced non-integer payload from rel (${rx}, ${ry}) in region (${region.x} ${region.y} ${region.width} ${region.height})`);
		}
		logPayload("rel_to_abs raw output", `${absX}|${absY}`);
		return [absX, absY];
	}

	private absToRel(ax: number, ay: number): [number, number] {
		const region = this.getContentRegion();
		logPayload("abs_to_rel region", `x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);
		if (region.width === 0 || region.height === 0) {
			die(`Invalid content region while converting abs (${ax}, ${ay})`);
		}
		return [(ax - region.x) / region.width, (ay - region.y) / region.height];
	}

	private validateRelativePair(x: number, y: number, label = "point"): void {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			die(`Invalid relative coordinates for ${label}: (${x}, ${y})`);
		}
	}

	private async applyAbsClickPoint(rx: number, ry: number, event = "c", label = "point"): Promise<[number, number]> {
		if (!(await this.ensureMirrorFrontmost(`apply-abs-click-${label}`))) {
			die(`Failed to ensure mirroring host is frontmost for ${label}`);
		}
		this.validateRelativePair(rx, ry, label);
		const [ax, ay] = this.relToAbs(rx, ry);
		const region = this.getContentRegion();
		if (ax < region.x || ax > region.x + region.width || ay < region.y || ay > region.y + region.height) {
			logStep(`apply_abs_click_point(${label}): point is outside computed content (${region.x},${region.y},${region.width},${region.height})`);
		}
		this.runCliclick(`${event}:${ax},${ay}`);
		return [ax, ay];
	}

	private async clickRel(rx: number, ry: number): Promise<void> {
		await this.applyAbsClickPoint(rx, ry, "c", "click");
	}

	private async dragRel(startX: number, startY: number, endX: number, endY: number): Promise<void> {
		const [sx, sy] = await this.applyAbsClickPoint(startX, startY, "dd", "drag-start");
		const [ex, ey] = await this.applyAbsClickPoint(endX, endY, "m", "drag-end-move");
		logStep(`drag_rel: absolute start ${sx},${sy} end ${ex},${ey}`);
		this.runCliclick(`du:${ex},${ey}`);
	}

	private async tapSequence(steps: string): Promise<void> {
		if (!(await this.ensureMirrorFrontmost("tap-sequence"))) {
			die("Could not ensure mirror host before tap sequence.");
		}

		for (const step of steps.split(";").map(trim).filter((entry) => entry.length > 0)) {
			const [rawRx, rawRy] = step.split(",");
			const x = validateRelativeToken("x", rawRx);
			const y = validateRelativeToken("y", rawRy);
			await this.clickRel(x, y);
			await sleep(0.15);
		}
	}

	private screenshotContent(out: string): void {
		mkdirSync(dirname(out), { recursive: true });
		const region = this.getContentRegion();
		const args = ["-x", "-R", `${region.x},${region.y},${region.width},${region.height}`, out];
		const result = asCommandResult("screencapture", args);
		if (result.exitCode !== 0) {
			die(`Failed to write screenshot '${out}': ${trim(result.output)}`);
		}
	}

	private async goHomeBestEffort(): Promise<void> {
		if (await this.sendHostKeystroke("h", "command", "go-home-key")) {
			logStep("go_home_best_effort: command+H issued");
		} else {
			logStep("go_home_best_effort: command+H failed; continuing with swipe-only fallback");
		}
		await sleep(0.4);
		await this.dragRel(0.5, 0.96, 0.5, 0.55);
		await sleep(0.4);
	}

	private async openAppFromHome(iconRx: number, iconRy: number): Promise<void> {
		if (!(await this.ensureMirrorFrontmost("open-app-from-home"))) {
			die("Could not ensure mirror host before opening app.");
		}
		await this.goHomeBestEffort();
		if (!(await this.ensureMirrorFrontmost("open-app:before-icon-tap"))) {
			die("Could not ensure mirror host before app icon tap.");
		}
		await this.clickRel(iconRx, iconRy);
		await sleep(APP_OPEN_DELAY_SEC);
	}

	private async clearField(): Promise<void> {
		if (!(await this.ensureMirrorFrontmost("clear-field"))) {
			die("Could not guarantee iPhone mirroring host is frontmost before clearing search.");
		}

		if (CLEAR_MODE === "select_all") {
			if (await this.sendHostKeystroke("a", "command", "select_all")) {
				this.runCliclick("kp:delete");
			} else {
				logStep("clear_field: select-all failed, falling back to backspace-mode");
				const fallbackCount = Number.isInteger(BACKSPACE_COUNT) ? BACKSPACE_COUNT : 40;
				for (let i = 0; i < fallbackCount; i += 1) {
					this.runCliclick("kp:delete");
				}
			}
			return;
		}

		if (CLEAR_MODE.startsWith("backspace:")) {
			const rawCount = CLEAR_MODE.slice("backspace:".length);
			const count = Number(rawCount);
			if (!Number.isInteger(count) || count < 0) {
				die(`Invalid CLEAR_MODE backspace count: ${rawCount}`);
			}
			for (let i = 0; i < count; i += 1) {
				this.runCliclick("kp:delete");
			}
			return;
		}

		die(`Unknown CLEAR_MODE: ${CLEAR_MODE}`);
	}

	private async typeAndCapturePerChar(app: SupportedApp, query: string, outdir: string, querySlug: string): Promise<void> {
		mkdirSync(outdir, { recursive: true });
		this.screenshotContent(`${outdir}/${app}_00_empty_${querySlug}.png`);
		for (let i = 0; i < query.length; i += 1) {
			if (!(await this.ensureMirrorFrontmost(`type-char-${app}`))) {
				die(`Could not ensure mirror host during character typing at index ${i}.`);
			}
			const ch = query[i];
			this.runCliclick(`t:${escapeTapText(ch)}`);
			await sleep(CHAR_DELAY_SEC);
			const prefix = String(i + 1).padStart(2, "0");
			this.screenshotContent(`${outdir}/${app}_${prefix}_${querySlug}.png`);
		}
	}

	private async runAppFlow(app: SupportedApp, query: string, outBase: string, querySlug: string): Promise<void> {
		const appDir = `${outBase}/${app}`;
		this.focusMirroring();
		await sleep(0.2);
		if (!(await this.ensureMirrorFrontmost(`run-app-${app}`))) {
			die(`Could not return focus to mirror host for ${app} flow.`);
		}
		this.logFrontmostState("run-app:post-focus");

		switch (app) {
			case "chrome":
				await this.openAppFromHome(CHROME_ICON_RX, CHROME_ICON_RY);
				await this.tapSequence(CHROME_SEARCH_STEPS);
				await this.clearField();
				await this.typeAndCapturePerChar("chrome", query, appDir, querySlug);
				break;
			case "instagram":
				await this.openAppFromHome(INSTAGRAM_ICON_RX, INSTAGRAM_ICON_RY);
				await this.tapSequence(INSTAGRAM_SEARCH_STEPS);
				await this.clearField();
				await this.typeAndCapturePerChar("instagram", query, appDir, querySlug);
				break;
			case "tiktok":
				await this.openAppFromHome(TIKTOK_ICON_RX, TIKTOK_ICON_RY);
				await this.tapSequence(TIKTOK_SEARCH_STEPS);
				await this.clearField();
				await this.typeAndCapturePerChar("tiktok", query, appDir, querySlug);
				break;
			default:
				die(`Unknown app: ${app}`);
		}
	}

	public printWindowMode(): void {
		this.ensurePreflightChecks();
		this.focusMirroring();
		const mirrorBounds = this.getMirrorWindowBounds();
		const contentRegion = this.getContentRegion(mirrorBounds);
		logStep("Computed window/content bounds successfully for diagnostics");
		console.log(`window: ${mirrorBounds}`);
		console.log(`content: ${contentRegion.x} ${contentRegion.y} ${contentRegion.width} ${contentRegion.height}`);
	}

	public calibrateMode(): void {
		this.ensurePreflightChecks();
		this.focusMirroring();
		mkdirSync("./calibration", { recursive: true });
		this.screenshotContent("./calibration/iphone_content.png");
		console.log("Wrote ./calibration/iphone_content.png");
	}

	public coordToRelMode(x: number, y: number): void {
		this.ensurePreflightChecks();
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			die("Invalid numeric coordinate passed to coord-to-rel");
		}
		const [rx, ry] = this.absToRel(x, y);
		console.log(`${rx.toFixed(6)} ${ry.toFixed(6)}`);
	}

	public pointCheckMode(x: number, y: number): void {
		this.ensurePreflightChecks();
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			die("Invalid numeric coordinate passed to point-check");
		}
		const [absX, absY] = this.relToAbs(x, y);
		console.log(`rel (${x}, ${y}) => abs (${absX}, ${absY})`);
	}

	public runPreflight(): void {
		this.ensurePreflightChecks();
		console.log("Preflight checks passed.");
	}

	public async captureMode(query: string, apps: SupportedApp[], outDir?: string): Promise<string> {
		this.ensurePreflightChecks();
		if (!query || query.length === 0) {
			die("Query must not be empty");
		}
		if (apps.length === 0) {
			die("Missing --apps");
		}
		for (const app of apps) {
			if (!SUPPORTED_APPS.includes(app)) {
				die(`Unknown app '${app}'. Use chrome,instagram,tiktok.`);
			}
		}

		const baseDir = outDir && outDir.length > 0 ? outDir : `./autofill_shots_${timestampSnapshot()}`;
		mkdirSync(baseDir, { recursive: true });
		const querySlug = sanitizeQueryForFilename(query);

		for (const app of apps) {
			await this.runAppFlow(app, query, baseDir, querySlug);
		}

		console.log(`Done. Output: ${baseDir}`);
		return baseDir;
	}

	private ensurePreflightChecks(): void {
		needCmd("osascript", "This command is built into macOS.");
		needCmd("awk", "This command is built into macOS.");
		needCmd("cliclick", "brew install cliclick");
		needCmd("screencapture", "This command is built into macOS.");
	}
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clearLine, createInterface, cursorTo, moveCursor } from "node:readline";

import {
	APP_LAUNCH_QUERY,
	APP_LAUNCH_RESULT_RX,
	APP_LAUNCH_RESULT_RY,
	CALIBRATION_PREVIEW_INTERVAL_MS,
	CAPTURE_PRE_ACTION_DELAY_SEC,
	CAPTURE_STEP_GAP_SEC,
	APP_OPEN_DELAY_SEC,
	BACKSPACE_COUNT,
	BASE_COORDINATES_FILE,
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
	type BaseCoordinatePoint,
	type BaseCoordinatesProfile,
	CALIBRATION_PROMPT_HEADER,
	CALIBRATION_SEARCH_BUTTON_PROMPT,
	RELATIVE_TOKEN_RE,
	sleep,
	trim,
	sanitizeQueryForFilename,
	timestampSnapshot,
	die,
	failWithConnectionHint,
	logPayload,
	logStep,
} from "./utils";
import type { Region, SupportedApp, WindowBounds } from "./utils";

export const SUPPORTED_APPS: ReadonlyArray<SupportedApp> = ["chrome", "instagram", "tiktok"];

type MouseLocationSample = {
	x: number;
	y: number;
	source: string;
	raw: string;
};

type CalibrationTelemetrySample = {
	x: number;
	y: number;
	relX: number;
	relY: number;
	source: string;
	raw: string;
	localX: number;
	localY: number;
	inBounds: boolean;
};

type CalibrationTelemetryPanelState = {
	lines: number;
};

function logAction(message: string): void {
	console.log(`[${LOG_PREFIX}] ${message}`);
}

async function sleepAfterAction(label: string, delaySec = CAPTURE_STEP_GAP_SEC): Promise<void> {
	if (delaySec <= 0) return;
	logAction(`Waiting ${delaySec}s after ${label}...`);
	await sleep(delaySec);
}

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
	const x1 = values[0];
	const y1 = values[1];
	const x2 = values[2];
	const y2 = values[3];
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
		die(`Could not parse bounds payload '${raw}'.`);
	}
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

function parseTapSteps(raw: string, label = "tap sequence"): [number, number][] {
	const steps = raw
		.split(";")
		.map(trim)
		.filter((entry) => entry.length > 0);
	if (steps.length === 0) {
		die(`Invalid ${label}: no steps.`);
	}

	const parsed: [number, number][] = [];
	for (const step of steps) {
		const tokens = step.split(",");
		if (tokens.length !== 2) {
			die(`Invalid ${label} step '${step}'. Expected 'x,y'.`);
		}
		const [rawX, rawY] = tokens;
		if (rawX === undefined || rawY === undefined) {
			die(`Invalid ${label} step '${step}'. Expected 'x,y'.`);
		}
		parsed.push([validateRelativeToken(`${label} x`, rawX), validateRelativeToken(`${label} y`, rawY)]);
	}

	return parsed;
}

function escapeTapText(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/:/g, "\\:");
}

function parseMouseLocation(raw: string): [number, number] {
	const candidates = [
		raw.match(/^\s*\{?\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\}?\s*$/),
		raw.match(/x:\s*([+-]?\d+(?:\.\d+)?)\s*,\s*y:\s*([+-]?\d+(?:\.\d+)?)\s*/i),
	];

	for (const match of candidates) {
		if (match === null) continue;
		const x = Number(match[1]);
		const y = Number(match[2]);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			return [x, y];
		}
	}

	die(`Unable to parse mouse coordinates from '${raw}'. Expected formats like "{x, y}" or "x, y".`);
}

function splitForTerminalWidth(text: string, width: number): string[] {
	const columns = Math.max(1, Math.floor(width));
	const paragraphs = text.split("\n");
	const result: string[] = [];
	for (const paragraph of paragraphs) {
		const segmenter =
			typeof Intl !== "undefined" && "Segmenter" in Intl
				? new Intl.Segmenter(undefined, { granularity: "grapheme" })
				: null;

		const graphemes: string[] = [];
		if (segmenter) {
			for (const segment of segmenter.segment(paragraph)) {
				graphemes.push(segment.segment);
			}
		} else {
			for (const segment of paragraph) {
				graphemes.push(segment);
			}
		}

		if (graphemes.length === 0) {
			result.push("");
			continue;
		}

		let cursor = 0;
		while (cursor < graphemes.length) {
			const line = graphemes.slice(cursor, cursor + columns).join("");
			result.push(line);
			cursor += columns;
		}
	}

	return result;
}

function renderPreviewPanel(text: string, previous: CalibrationTelemetryPanelState): CalibrationTelemetryPanelState {
	if (!process.stdout.isTTY) {
		console.log(text);
		return { lines: 1 };
	}

	const width = Math.max(20, process.stdout.columns ?? 120);
	const lines = splitForTerminalWidth(text, width);
	const targetLines = Math.max(previous.lines, lines.length);
	const moveUp = Math.max(0, previous.lines - 1);

	if (moveUp > 0) {
		moveCursor(process.stdout, 0, -moveUp);
		cursorTo(process.stdout, 0);
	}

	for (let i = 0; i < targetLines; i += 1) {
		clearLine(process.stdout, 0);
		cursorTo(process.stdout, 0);
		if (i < lines.length) {
			process.stdout.write(lines[i]);
		}
		if (i < targetLines - 1) {
			process.stdout.write("\n");
		}
	}

	cursorTo(process.stdout, 0);
	return { lines: lines.length };
}

function resetPreviewPanel(previous: CalibrationTelemetryPanelState): void {
	if (!process.stdout.isTTY || previous.lines <= 0) {
		return;
	}

	const moveUp = Math.max(0, previous.lines - 1);
	moveCursor(process.stdout, 0, -moveUp);
	cursorTo(process.stdout, 0);
	for (let i = 0; i < previous.lines; i += 1) {
		clearLine(process.stdout, 0);
		cursorTo(process.stdout, 0);
		if (i < previous.lines - 1) {
			process.stdout.write("\n");
		}
	}
}

function buildCalibrationTelemetry(sample: MouseLocationSample, region: Region): CalibrationTelemetrySample {
	const localX = sample.x - region.x;
	const localY = sample.y - region.y;
	const relX = region.width === 0 ? Number.NaN : localX / region.width;
	const relY = region.height === 0 ? Number.NaN : localY / region.height;
	const relXSafe = Number.isFinite(relX) ? relX : Number.NaN;
	const relYSafe = Number.isFinite(relY) ? relY : Number.NaN;
	const inBounds =
		Number.isFinite(relXSafe) &&
		Number.isFinite(relYSafe) &&
		relXSafe >= 0 &&
		relXSafe <= 1 &&
		relYSafe >= 0 &&
		relYSafe <= 1;

	return {
		x: sample.x,
		y: sample.y,
		relX: relXSafe,
		relY: relYSafe,
		source: sample.source,
		raw: sample.raw,
		localX,
		localY,
		inBounds,
	};
}

function formatCalibrationPreview(label: string, sample: CalibrationTelemetrySample, region: Region): string {
	const relText = Number.isFinite(sample.relX) && Number.isFinite(sample.relY)
		? `(${sample.relX.toFixed(6)}, ${sample.relY.toFixed(6)})`
		: "(NaN, NaN)";
	const boundsText = sample.inBounds ? "" : " [OUT OF CONTENT REGION]";
	return (
		`Calibration preview [${label}]: source=${sample.source} raw=${sample.raw} | ` +
		`screen=(${sample.x}, ${sample.y}) | contentRegion=(x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}) | ` +
		`contentLocal=(${sample.localX}, ${sample.localY}) | rel=${relText}${boundsText}`
	);
}

function queryMouseLocation(): MouseLocationSample {
	try {
		const osaResult = asCommandResult("osascript", [
			"-e",
			`tell application "System Events"\nset mouseXY to mouse location\nreturn mouseXY\nend tell`,
		]);
		if (osaResult.exitCode !== 0) {
			throw new Error(trim(osaResult.output));
		}
		const osaOutput = trim(osaResult.output);
		const [x, y] = parseMouseLocation(osaOutput);
		return { x, y, source: "osascript", raw: osaOutput };
	} catch {
		const cliclickResult = asCommandResult("cliclick", ["p"]);
		if (cliclickResult.exitCode !== 0) {
			die("Unable to read mouse location. Ensure Accessibility permissions are enabled for Terminal/System Events and try again.");
		}
		const raw = trim(cliclickResult.output);
		const [x, y] = parseMouseLocation(raw);
		return { x, y, source: "cliclick", raw };
	}
}

async function promptAndCapturePoint(label: string, contentRegion: Region): Promise<void> {
	console.log(CALIBRATION_PROMPT_HEADER);
	console.log(label);
	console.log("  - Move your mouse pointer over the target point in the mirrored iPhone.");
	console.log("  - Keep both this terminal and the iPhone mirroring window visible.");
	console.log("  - Make sure this terminal is focused before pressing Enter.");
	console.log("  - Press Enter to sample that point.");
	console.log("  - Press Ctrl+C to cancel.");
	await new Promise<void>((resolve, reject) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		let resolved = false;
		const state: CalibrationTelemetryPanelState = { lines: 0 };
		let interval: ReturnType<typeof setInterval> | null = null;

		const renderTelemetry = () => {
			let sample: MouseLocationSample;
			try {
				sample = queryMouseLocation();
			} catch {
				return;
			}
			const telemetry = buildCalibrationTelemetry(sample, contentRegion);
			const line = formatCalibrationPreview(label, telemetry, contentRegion);
			state.lines = renderPreviewPanel(line, state).lines;
		};

		const finalize = (error?: Error) => {
			if (resolved) return;
			resolved = true;
			if (interval !== null) {
				clearInterval(interval);
				interval = null;
			}
			resetPreviewPanel(state);
			process.stdout.write("\n");
			rl.close();
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};

		interval = setInterval(renderTelemetry, CALIBRATION_PREVIEW_INTERVAL_MS);
		renderTelemetry();

		rl.once("line", () => {
			finalize();
		});

		rl.once("close", () => {
			finalize();
		});

		rl.on("SIGINT", () => {
			finalize(new Error("Calibration prompt canceled by user."));
		});
	});
}

export class AutofillAutomation {
	private calibrationProfile?: BaseCoordinatesProfile;

	private static createFallbackCalibrationErrorMessage(): string {
		return [
			`Missing or invalid base-coordinate calibration file: ${BASE_COORDINATES_FILE}.`,
			"Run: bun run capture -- --calibrate",
			"Then rerun your capture command.",
		].join(" ");
	}

	private clamp01(value: number): number {
		if (!Number.isFinite(value)) {
			return Number.NaN;
		}
		return Math.max(0, Math.min(1, value));
	}

	private clamp01Checked(value: number, label: string): number {
		if (!Number.isFinite(value)) {
			die(`Invalid relative value in ${label}: ${value}`);
		}
		return this.clamp01(value);
	}

	private validateCalibrationValue(value: unknown, label: string): number {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			die(`Invalid ${label}: expected finite number.`);
		}
		return value;
	}

	private validateCalibrationPoint(value: unknown, label: string): BaseCoordinatePoint {
		if (typeof value !== "object" || value === null) {
			die(`Invalid ${label}: expected object.`);
		}
		const typed = value as Record<string, unknown>;
		const relX = this.validateCalibrationValue(typed.relX, `${label}.relX`);
		const relY = this.validateCalibrationValue(typed.relY, `${label}.relY`);
		const absX = typed.absX === undefined ? undefined : this.validateCalibrationValue(typed.absX, `${label}.absX`);
		const absY = typed.absY === undefined ? undefined : this.validateCalibrationValue(typed.absY, `${label}.absY`);
		return { relX: this.clamp01Checked(relX, `${label}.relX`), relY: this.clamp01Checked(relY, `${label}.relY`), absX, absY };
	}

	private validateCalibrationProfile(rawProfile: unknown): BaseCoordinatesProfile {
		if (typeof rawProfile !== "object" || rawProfile === null) {
			die(AutofillAutomation.createFallbackCalibrationErrorMessage());
		}
		const profile = rawProfile as Record<string, unknown>;

		const version = this.validateCalibrationValue(profile.version, "profile.version");
		if (!Number.isInteger(version) || version < 1) {
			die("Unsupported or invalid base-coordinate profile version.");
		}
		const generatedAt = typeof profile.generatedAt === "string" ? profile.generatedAt : "";
		if (generatedAt.length === 0) {
			die("Invalid profile.generatedAt: expected non-empty string.");
		}

		const mirrorWindowRaw = profile.mirrorWindow;
		if (typeof mirrorWindowRaw !== "object" || mirrorWindowRaw === null) {
			die("Invalid profile.mirrorWindow: expected bounds object.");
		}
		const mirrorWindowObj = mirrorWindowRaw as Record<string, unknown>;
		const mirrorWindow: WindowBounds = {
			x1: this.validateCalibrationValue(mirrorWindowObj.x1, "profile.mirrorWindow.x1"),
			y1: this.validateCalibrationValue(mirrorWindowObj.y1, "profile.mirrorWindow.y1"),
			x2: this.validateCalibrationValue(mirrorWindowObj.x2, "profile.mirrorWindow.x2"),
			y2: this.validateCalibrationValue(mirrorWindowObj.y2, "profile.mirrorWindow.y2"),
		};
		if (mirrorWindow.x2 <= mirrorWindow.x1 || mirrorWindow.y2 <= mirrorWindow.y1) {
			die("Invalid profile.mirrorWindow: empty or inverted bounds.");
		}

		const contentRegionRaw = profile.contentRegion;
		if (typeof contentRegionRaw !== "object" || contentRegionRaw === null) {
			die("Invalid profile.contentRegion: expected region object.");
		}
		const contentRegionObj = contentRegionRaw as Record<string, unknown>;
		const contentRegion: Region = {
			x: this.validateCalibrationValue(contentRegionObj.x, "profile.contentRegion.x"),
			y: this.validateCalibrationValue(contentRegionObj.y, "profile.contentRegion.y"),
			width: this.validateCalibrationValue(contentRegionObj.width, "profile.contentRegion.width"),
			height: this.validateCalibrationValue(contentRegionObj.height, "profile.contentRegion.height"),
		};
		if (contentRegion.width <= 0 || contentRegion.height <= 0) {
			die("Invalid profile.contentRegion: width/height must be greater than zero.");
		}

		const pointsRaw = profile.points;
		if (typeof pointsRaw !== "object" || pointsRaw === null) {
			die("Invalid profile.points: expected object.");
		}
		const pointsObj = pointsRaw as Record<string, unknown>;
		const homeSearchButton = this.validateCalibrationPoint(pointsObj.homeSearchButton, "profile.points.homeSearchButton");
		const launchResultTap = this.validateCalibrationPoint(pointsObj.launchResultTap, "profile.points.launchResultTap");

		const appSearchStepsRaw = pointsObj.appSearchSteps;
		if (typeof appSearchStepsRaw !== "object" || appSearchStepsRaw === null) {
			die("Invalid profile.points.appSearchSteps: expected map of app names to tap sequences.");
		}

		const appSearchStepsObj = appSearchStepsRaw as Record<string, unknown>;
		const appSearchSteps: Record<SupportedApp, string> = {
			chrome: "",
			instagram: "",
			tiktok: "",
		};

		for (const app of SUPPORTED_APPS) {
			const rawStep = appSearchStepsObj[app];
			if (typeof rawStep !== "string" || trim(rawStep).length === 0) {
				die(`Invalid profile.points.appSearchSteps.${app}: expected non-empty string.`);
			}
			try {
				parseTapSteps(rawStep, `profile.points.appSearchSteps.${app}`);
			} catch {
				die(`Invalid profile.points.appSearchSteps.${app}: ${rawStep}`);
			}
			appSearchSteps[app] = rawStep.trim();
		}

		return {
			version: Math.trunc(version),
			generatedAt,
			mirrorWindow,
			contentRegion,
			points: {
				homeSearchButton,
				launchResultTap,
				appSearchSteps,
			},
		};
	}

	private getCalibrationProfile(): BaseCoordinatesProfile {
		if (this.calibrationProfile) return this.calibrationProfile;
		if (!existsSync(BASE_COORDINATES_FILE)) {
			die(AutofillAutomation.createFallbackCalibrationErrorMessage());
		}

		let raw: string;
		try {
			raw = readFileSync(BASE_COORDINATES_FILE, "utf8");
		} catch {
			die(AutofillAutomation.createFallbackCalibrationErrorMessage());
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			die(AutofillAutomation.createFallbackCalibrationErrorMessage());
		}

		this.calibrationProfile = this.validateCalibrationProfile(parsed);
		return this.calibrationProfile;
	}

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

	private relToAbsWithRegion(rx: number, ry: number, region: Region): [number, number] {
		const x = region.x + region.width * rx;
		const y = region.y + region.height * ry;
		const absX = Math.round(x);
		const absY = Math.round(y);
		if (!Number.isInteger(absX) || !Number.isInteger(absY)) {
			die(`rel_to_abs_with_region produced non-integer payload from rel (${rx}, ${ry}) in region (${region.x} ${region.y} ${region.width} ${region.height})`);
		}
		return [absX, absY];
	}

	private absToRelWithinRegion(ax: number, ay: number, region: Region, label = "point"): [number, number] {
		if (region.width === 0 || region.height === 0) {
			die(`Invalid content region while converting absolute point (${ax}, ${ay}) for ${label}`);
		}
		const relX = (ax - region.x) / region.width;
		const relY = (ay - region.y) / region.height;
		if (!Number.isFinite(relX) || !Number.isFinite(relY)) {
			die(`Could not convert absolute point (${ax}, ${ay}) to relative for ${label}`);
		}
		if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
			die(
				[
					`Captured point for ${label} is outside the current mirrored content region.`,
					`screen=(${ax}, ${ay}) local=(${ax - region.x}, ${ay - region.y}) region=(x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}) rel=(${relX}, ${relY})`,
					"Open iPhone Mirroring, place the pointer directly on the Search button, then rerun:",
					"bun run capture -- --calibrate",
				].join(" "),
			);
		}
		return [relX, relY];
	}

	private logCalibrationCapture(
		label: string,
		sample: MouseLocationSample,
		contentRegion: Region,
		relX: number,
		relY: number,
	): void {
		const contentLocalX = sample.x - contentRegion.x;
		const contentLocalY = sample.y - contentRegion.y;
		console.log(
			`Calibration sample (${label}): source=${sample.source} raw=${sample.raw} | screen=(${sample.x},${sample.y}) | contentRegion=(x=${contentRegion.x}, y=${contentRegion.y}, w=${contentRegion.width}, h=${contentRegion.height}) | contentLocal=(${contentLocalX}, ${contentLocalY}) | rel=(${relX.toFixed(6)}, ${relY.toFixed(6)})`,
		);
	}

	private async captureHomeSearchFromMouse(contentRegion: Region): Promise<BaseCoordinatePoint> {
		await promptAndCapturePoint(CALIBRATION_SEARCH_BUTTON_PROMPT, contentRegion);
		const sample = queryMouseLocation();
		const [relX, relY] = this.absToRelWithinRegion(sample.x, sample.y, contentRegion, "Search button");
		this.logCalibrationCapture("Search button", sample, contentRegion, relX, relY);
		return {
			relX,
			relY,
			absX: sample.x,
			absY: sample.y,
		};
	}

	private makeBasePointFromRel(rx: number, ry: number, region: Region): BaseCoordinatePoint {
		const [absX, absY] = this.relToAbsWithRegion(rx, ry, region);
		return { relX: rx, relY: ry, absX, absY };
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

		for (const [x, y] of parseTapSteps(steps, "tap-sequence")) {
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
		logAction("Issuing Command+H");
		if (await this.sendHostKeystroke("h", "command", "go-home-key")) {
			logAction("Command+H sent");
			await sleepAfterAction("home-command");
		} else {
			logAction("Command+H failed; using swipe fallback");
		}
		await sleep(0.4);
		await this.dragRel(0.5, 0.96, 0.5, 0.55);
		await sleepAfterAction("home-swipe-fallback");
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

	private async typeText(text: string): Promise<void> {
		if (!(await this.ensureMirrorFrontmost("type-text"))) {
			die("Could not ensure mirroring host before typing text.");
		}

		for (const ch of text) {
			this.runCliclick(`t:${escapeTapText(ch)}`);
			await sleep(0.1);
		}
	}

	private getSearchStepsFromProfile(app: SupportedApp): string {
		const profile = this.getCalibrationProfile();
		const steps = profile.points.appSearchSteps[app];
		if (!steps) {
			die(`No search steps in calibration for app '${app}'.`);
		}
		return steps;
	}

	private getSearchButtonProfilePoint() : BaseCoordinatePoint {
		return this.getCalibrationProfile().points.homeSearchButton;
	}

	private getLaunchResultProfilePoint(): BaseCoordinatePoint {
		return this.getCalibrationProfile().points.launchResultTap;
	}

	private async openAppBySearch(app: SupportedApp): Promise<void> {
		const appName = APP_LAUNCH_QUERY[app];
		const searchPoint = this.getSearchButtonProfilePoint();
		const launchPoint = this.getLaunchResultProfilePoint();

		logAction(`Opening ${app} via Search flow`);
		if (!(await this.ensureMirrorFrontmost("open-app-by-search:initial-focus"))) {
			die("Could not ensure mirror host before search launch.");
		}
		await this.goHomeBestEffort();
		await sleepAfterAction("post-go-home");

		if (!(await this.ensureMirrorFrontmost("open-app-by-search:search-button"))) {
			die("Could not ensure mirror host before tapping Search.");
		}
		logAction("Tapping Search icon");
		await this.clickRel(searchPoint.relX, searchPoint.relY);
		await sleepAfterAction("search-icon-tap");
		await sleep(0.3);
		logAction("Clearing Search field");
		await this.clearField();
		await sleepAfterAction("search-clear");
		logAction(`Typing app name '${appName}'`);
		await this.typeText(appName);
		await sleepAfterAction("search-typing");
		await sleep(0.35);
		logAction("Tapping launch result");
		await this.clickRel(launchPoint.relX, launchPoint.relY);
		await sleepAfterAction("launch-result-tap");
		await sleep(APP_OPEN_DELAY_SEC);
	}

	private async openAppBySearchWithFallback(app: SupportedApp): Promise<void> {
		logAction(`Starting app launch for ${app}`);
		try {
			await this.openAppBySearch(app);
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logAction(`Search flow failed for ${app}: ${message}`);
			logAction("Falling back to home icon launch");
		}

		switch (app) {
			case "chrome":
				await this.openAppFromHome(CHROME_ICON_RX, CHROME_ICON_RY);
				break;
			case "instagram":
				await this.openAppFromHome(INSTAGRAM_ICON_RX, INSTAGRAM_ICON_RY);
				break;
			case "tiktok":
				await this.openAppFromHome(TIKTOK_ICON_RX, TIKTOK_ICON_RY);
				break;
			default:
				die(`Unknown app: ${app}`);
		}
	}

	private async clearField(): Promise<void> {
		if (!(await this.ensureMirrorFrontmost("clear-field"))) {
			die("Could not guarantee iPhone mirroring host is frontmost before clearing search.");
		}

		const clearMode = String(CLEAR_MODE);

		if (clearMode === "select_all") {
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
		} else if (clearMode.startsWith("backspace:")) {
			const rawCount = clearMode.slice("backspace:".length);
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
		const ch = query.charAt(i);
		this.runCliclick(`t:${escapeTapText(ch)}`);
			await sleep(CHAR_DELAY_SEC);
			const prefix = String(i + 1).padStart(2, "0");
			this.screenshotContent(`${outdir}/${app}_${prefix}_${querySlug}.png`);
		}
	}

	private async runAppFlow(app: SupportedApp, query: string, outBase: string, querySlug: string): Promise<void> {
		const appDir = `${outBase}/${app}`;
		this.focusMirroring();
		logAction(`Starting app flow for ${app} (query="${query}", outBase="${outBase}")`);
		await sleep(0.2);
		await sleepAfterAction("focus-mirroring");
		if (!(await this.ensureMirrorFrontmost(`run-app-${app}`))) {
			die(`Could not return focus to mirror host for ${app} flow.`);
		}
		await sleepAfterAction("run-app-frontmost");
		this.logFrontmostState("run-app:post-focus");
		this.getCalibrationProfile();
		const steps = this.getSearchStepsFromProfile(app);

		switch (app) {
			case "chrome":
				await this.openAppBySearchWithFallback("chrome");
				await this.tapSequence(steps);
				await this.clearField();
				await this.typeAndCapturePerChar("chrome", query, appDir, querySlug);
				break;
			case "instagram":
				await this.openAppBySearchWithFallback("instagram");
				await this.tapSequence(steps);
				await this.clearField();
				await this.typeAndCapturePerChar("instagram", query, appDir, querySlug);
				break;
			case "tiktok":
				await this.openAppBySearchWithFallback("tiktok");
				await this.tapSequence(steps);
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

	public async calibrateMode(): Promise<void> {
		this.ensurePreflightChecks();
		this.focusMirroring();
		const mirrorWindowBounds = this.getMirrorWindowBounds();
		const mirrorWindow = parseBoundsTuple(mirrorWindowBounds);
		const contentRegion = this.getContentRegion(mirrorWindowBounds);
		console.log(
			`Using content region: x=${contentRegion.x} y=${contentRegion.y} w=${contentRegion.width} h=${contentRegion.height}`,
		);
		const homeSearchButton = await this.captureHomeSearchFromMouse(contentRegion);

		const baseCoordinatesProfile: BaseCoordinatesProfile = {
			version: 1,
			generatedAt: new Date().toISOString(),
			mirrorWindow,
			contentRegion,
			points: {
				homeSearchButton,
				launchResultTap: this.makeBasePointFromRel(APP_LAUNCH_RESULT_RX, APP_LAUNCH_RESULT_RY, contentRegion),
				appSearchSteps: {
					chrome: CHROME_SEARCH_STEPS,
					instagram: INSTAGRAM_SEARCH_STEPS,
					tiktok: TIKTOK_SEARCH_STEPS,
				},
			},
		};

		mkdirSync("./calibration", { recursive: true });
		this.screenshotContent("./calibration/iphone_content.png");
		writeFileSync(BASE_COORDINATES_FILE, `${JSON.stringify(baseCoordinatesProfile, null, 2)}\n`);
		console.log("Wrote ./calibration/iphone_content.png");
		console.log("Wrote ./calibration/base-coordinates.json");
		this.calibrationProfile = baseCoordinatesProfile;
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

		if (CAPTURE_PRE_ACTION_DELAY_SEC > 0) {
			console.log(`Starting capture: waiting ${CAPTURE_PRE_ACTION_DELAY_SEC}s for mirroring/host to settle before actions...`);
			await sleep(CAPTURE_PRE_ACTION_DELAY_SEC);
		} else {
			console.log("Starting capture: no pre-action delay configured.");
		}

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

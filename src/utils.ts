export type SupportedApp = "chrome" | "instagram" | "tiktok";
export type AppFlowMode =
	| "capture"
	| "print-window"
	| "calibrate"
	| "calibrate-action"
	| "calibrate-all"
	| "coord-to-rel"
	| "point-check";

export interface CliConfig {
	query?: string;
	apps?: SupportedApp[];
	out?: string;
	printWindow?: boolean;
	calibrate?: boolean;
	calibrateAction?: string;
	calibrateAll?: boolean;
	coordToRel?: [number, number];
	pointCheck?: [number, number];
}

export interface WindowBounds {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BaseCoordinatePoint {
	relX: number;
	relY: number;
	absX?: number;
	absY?: number;
}

export type ActionPointByAppName = Partial<Record<string, BaseCoordinatePoint>>;
export type ActionPointsByApp = Partial<Record<SupportedApp, ActionPointByAppName>>;

export interface BaseCoordinatesProfile {
	version: number;
	generatedAt: string;
	mirrorWindow: WindowBounds;
	contentRegion: Region;

	points: {
		homeSearchButton: BaseCoordinatePoint;
		launchResultTap: BaseCoordinatePoint;
		appSearchSteps: Record<SupportedApp, string>;
		appActionPoints?: ActionPointsByApp;
	};
}

export interface ActionCalibrationDefinition {
	id: string;
	label: string;
	forApp: SupportedApp;
	fallbackTapSteps?: string;
	requiredForCapture?: boolean;
	skipInCalibrateAll?: boolean;
}

export const LOG_PREFIX = "iphone-mirror-autofill";

export const MIRROR_APP_NAME = "iPhone Mirroring";
export const MIRROR_APP_FALLBACK = "QuickTime Player";
export const MIRROR_HOME_SHORTCUT_KEY = "1";
export const MIRROR_SEARCH_SHORTCUT_KEY = "3";

export const INSET_LEFT = 10;
export const INSET_TOP = 48;
export const INSET_RIGHT = 10;
export const INSET_BOTTOM = 10;

export const COORD_SCALE = 1;

export const CHAR_DELAY_SEC = 4;
export const APP_OPEN_DELAY_SEC = 4;

export const BASE_COORDINATES_FILE = "./calibration/base-coordinates.json";

export const APP_LAUNCH_QUERY: Readonly<Record<SupportedApp, string>> = {
	chrome: "Chrome",
	instagram: "Instagram",
	tiktok: "TikTok",
};

export const APP_HOME_SEARCH_RX = 0.5;
export const APP_HOME_SEARCH_RY = 0.91;
export const APP_LAUNCH_RESULT_RX = 0.5;
export const APP_LAUNCH_RESULT_RY = 0.63;

export const CALIBRATION_PREVIEW_INTERVAL_MS = 150;

export const CALIBRATION_PROMPT_HEADER = "🔧 Calibration: interactive coordinate capture";
export const CALIBRATION_SEARCH_BUTTON_PROMPT = "Target: iPhone Home Screen Search button";

export const CHROME_ICON_RX = 0.18;
export const CHROME_ICON_RY = 0.78;
export const INSTAGRAM_ICON_RX = 0.40;
export const INSTAGRAM_ICON_RY = 0.78;
export const TIKTOK_ICON_RX = 0.62;
export const TIKTOK_ICON_RY = 0.78;

export const CHROME_SEARCH_STEPS = "0.50,0.10";
export const INSTAGRAM_SEARCH_STEPS = "0.20,0.95;0.50,0.12";
export const TIKTOK_SEARCH_STEPS = "0.92,0.08;0.50,0.12";

export const ACTION_CALIBRATION_DEFINITIONS: ReadonlyArray<ActionCalibrationDefinition> = [
	{
		id: "chrome:ellipsis",
		label: "Chrome ellipsis/options",
		forApp: "chrome",
		requiredForCapture: true,
	},
	{
		id: "chrome:newIncognitoTab",
		label: "Chrome new incognito tab",
		forApp: "chrome",
		requiredForCapture: true,
	},
	{
		id: "chrome:searchBar",
		label: "Chrome search bar",
		forApp: "chrome",
		fallbackTapSteps: CHROME_SEARCH_STEPS,
	},
	{
		id: "chrome:searchIcon",
		label: "Chrome search icon",
		forApp: "chrome",
	},
	{
		id: "instagram:searchIcon",
		label: "Instagram search icon",
		forApp: "instagram",
	},
	{
		id: "tiktok:searchIcon",
		label: "TikTok search icon",
		forApp: "tiktok",
	},
	{
		id: "chrome:homeIcon",
		label: "Chrome home icon",
		forApp: "chrome",
	},
	{
		id: "instagram:homeIcon",
		label: "Instagram home icon",
		forApp: "instagram",
	},
	{
		id: "tiktok:homeIcon",
		label: "TikTok home icon",
		forApp: "tiktok",
	},
];

export function isSupportedActionTarget(value: string): value is `${SupportedApp}:${string}` {
	if (!value.includes(":")) {
		return false;
	}
	const [rawApp, rawAction] = value.split(":");
	if (!rawApp || !rawAction) {
		return false;
	}
	const app = trim(rawApp).toLowerCase();
	if (app !== "chrome" && app !== "instagram" && app !== "tiktok") {
		return false;
	}
	return ACTION_CALIBRATION_DEFINITIONS.some((definition) => definition.id === `${app}:${trim(rawAction)}`);
}

export function parseActionTarget(rawValue: string): { app: SupportedApp; action: string } {
	const normalized = trim(rawValue);
	if (!normalized.length) {
		die("Invalid --calibrate-action value: expected app:action");
	}

	const parts = normalized.split(":");
	if (parts.length !== 2) {
		die("Invalid --calibrate-action format. Expected app:action, for example chrome:searchBar.");
	}

	const rawApp = trim(parts[0] ?? "");
	const rawAction = trim(parts[1] ?? "");
	if (!rawApp || !rawAction) {
		die("Invalid --calibrate-action format. Expected app:action, for example chrome:searchBar.");
	}

	if (!isSupportedActionTarget(`${rawApp.toLowerCase()}:${rawAction}`)) {
		die(`Unknown action '${rawApp.toLowerCase()}:${rawAction}'. Supported actions: ${ACTION_CALIBRATION_DEFINITIONS.map((definition) => definition.id).join(", ")}`);
	}

	return { app: rawApp.toLowerCase() as SupportedApp, action: rawAction };
}

export function getActionDefinition(app: SupportedApp, action: string): ActionCalibrationDefinition | undefined {
	const target = `${app}:${action}`;
	return ACTION_CALIBRATION_DEFINITIONS.find((definition) => definition.id === target);
}

export function getActionTargetsForApp(app: SupportedApp): ActionCalibrationDefinition[] {
	return ACTION_CALIBRATION_DEFINITIONS.filter((definition) => definition.forApp === app);
}

export const CLEAR_MODE = "select_all";
export const BACKSPACE_COUNT = 40;

export const PRINT_WINDOW_DEBUG = (() => {
	const raw = process.env.PRINT_WINDOW_DEBUG;
	if (raw === undefined) return false;
	if (raw === "") return true;
	if (raw === "0") return false;
	if (raw === "false" || raw === "False" || raw === "FALSE") return false;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? true : parsed !== 0;
})();

export const CAPTURE_PRE_ACTION_DELAY_SEC = (() => {
	const raw = process.env.CAPTURE_PRE_ACTION_DELAY_SEC;
	const defaultDelay = 4;
	if (raw === undefined || raw.length === 0) {
		return defaultDelay;
	}
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed;
	}
	if (PRINT_WINDOW_DEBUG) {
		console.error(`[${LOG_PREFIX}] Invalid CAPTURE_PRE_ACTION_DELAY_SEC='${raw}', using default ${defaultDelay}s.`);
	}
	return defaultDelay;
})();

export const CAPTURE_STEP_GAP_SEC = (() => {
	const raw = process.env.CAPTURE_STEP_GAP_SEC;
	const defaultDelay = 4;
	if (raw === undefined || raw.length === 0) {
		return defaultDelay;
	}
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed;
	}
	if (PRINT_WINDOW_DEBUG) {
		console.error(`[${LOG_PREFIX}] Invalid CAPTURE_STEP_GAP_SEC='${raw}', using default ${defaultDelay}s.`);
	}
	return defaultDelay;
})();

export const CAPTURE_FAST_STEP_GAP_SEC = (() => {
	const raw = process.env.CAPTURE_FAST_STEP_GAP_SEC;
	const defaultDelay = 0.7;
	if (raw === undefined || raw.length === 0) {
		return defaultDelay;
	}
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed;
	}
	if (PRINT_WINDOW_DEBUG) {
		console.error(`[${LOG_PREFIX}] Invalid CAPTURE_FAST_STEP_GAP_SEC='${raw}', using default ${defaultDelay}s.`);
	}
	return defaultDelay;
})();

export const CAPTURE_USE_MIRROR_SHORTCUTS = (() => {
	const raw = process.env.CAPTURE_USE_MIRROR_SHORTCUTS;
	if (raw === undefined || raw.length === 0) {
		return true;
	}
	const lowered = raw.toLowerCase();
	if (raw.length === 1 && (raw === "1" || raw === "0")) {
		return raw === "1";
	}
	if (["true", "yes", "on", "enabled"].includes(lowered)) {
		return true;
	}
	if (["false", "no", "off", "disabled", "0"].includes(lowered)) {
		return false;
	}
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed !== 0) {
		return true;
	}
	if (PRINT_WINDOW_DEBUG) {
		console.error(`[${LOG_PREFIX}] Invalid CAPTURE_USE_MIRROR_SHORTCUTS='${raw}', using default true.`);
	}
	return true;
})();

export const RELATIVE_TOKEN_RE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|[0-9]*\.[0-9]+)$/;

export class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

export function die(message: string): never {
	throw new CliError(message);
}

export function trim(value: string): string {
	return value.trim();
}

export function sleep(seconds: number): Promise<void> {
	if (seconds <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function logStep(message: string): void {
	if (!PRINT_WINDOW_DEBUG) return;
	const now = new Date();
	const time = now.toTimeString().slice(0, 8);
	console.error(`[${LOG_PREFIX}] ${time} - ${message}`);
}

export function logPayload(label: string, payload: string): void {
	if (!PRINT_WINDOW_DEBUG) return;
	console.error(`[${LOG_PREFIX}] ${label}: ${payload}`);
}

export function sanitizeQueryForFilename(raw: string): string {
	const slug = raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+/, "")
		.replace(/_+$/, "")
		.replace(/__+/g, "_");
	return slug.length > 0 ? slug : "query";
}

export function parseNumberToken(label: string, token: string): number {
	const normalized = trim(token);
	if (normalized.length === 0) {
		die(`Invalid ${label}: empty`);
	}

	if (!RELATIVE_TOKEN_RE.test(normalized)) {
		die(`Invalid ${label}: '${token}'`);
	}

	const value = Number(normalized);
	if (!Number.isFinite(value)) {
		die(`Invalid ${label}: '${token}'`);
	}

	return value;
}

export function timestampSnapshot(): string {
	const now = new Date();
	const yyyy = now.getFullYear().toString();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mi = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

export function formatUsage(): string {
	return `Usage:
  bun run capture -- --query "pizza" --apps chrome,instagram,tiktok [--out ./outdir]

	Modes:
	  --query "text"         Required search text to type one character at a time
	  --apps "a,b,c"         Required app list (chrome,instagram,tiktok) any subset
	  --out path             Optional output folder (defaults to ./autofill_shots_YYYYmmdd_HHMMSS)

	Utility:
	  --print-window         Print iPhone mirroring window bounds and computed content bounds
	  --calibrate            Interactive calibrate: capture Search button coordinate from mouse and write calibration/base-coordinates.json
	  --calibrate-action KEY  Calibrate an app action coordinate. Key format: app:action
	                        Supported: chrome:searchBar, chrome:ellipsis, chrome:newIncognitoTab, chrome:searchIcon, chrome:homeIcon, instagram:searchIcon, instagram:homeIcon, tiktok:searchIcon, tiktok:homeIcon
	  --calibrate-all         Interactive calibrate all supported action points in one pass
	  --coord-to-rel X Y     Convert absolute screen coordinates to relative (0..1)
	  --point-check RX RY     Validate relative-to-absolute conversion for debug
	  -h, --help             Print this help text

Requirements:
  - macOS
  - iPhone Mirroring open and visible
  - Accessibility + Screen Recording for your terminal app
  - Commands: osascript, cliclick, screencapture, awk`;
}

export function mirroringConnectionHint(): void {
	console.error('If the phone is not actively mirrored, complete the iPhone Mirroring connection flow on-screen:');
	console.error(' - In iPhone Mirroring on macOS, select your iPhone');
	console.error(' - Accept any pairing prompt and enter the passcode on your iPhone if requested');
	console.error(' - Tap "Connect" (or equivalent) to establish the Mirroring session');
	console.error(' - Wait until the phone UI is visible in the window before rerunning this script');
	console.error(' - If the UI is visible but automation still fails, verify:');
	console.error('   - Prefer using the macOS Terminal.app for initial Automation/Accessibility permission prompts');
	console.error('   - System Settings > Privacy & Security > Accessibility includes your terminal app');
	console.error('   - System Settings > Privacy & Security > Automation allows your terminal app to control System Events and iPhone Mirroring');
}

export function failWithConnectionHint(message: string): never {
	console.error(`error: ${message}`);
	mirroringConnectionHint();
	die(message);
}

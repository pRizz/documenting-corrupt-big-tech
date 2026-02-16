export type SupportedApp = "chrome" | "instagram" | "tiktok";
export type AppFlowMode = "capture" | "print-window" | "calibrate" | "coord-to-rel" | "point-check";

export interface CliConfig {
	query?: string;
	apps?: SupportedApp[];
	out?: string;
	printWindow?: boolean;
	calibrate?: boolean;
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

export interface BaseCoordinatesProfile {
	version: number;
	generatedAt: string;
	mirrorWindow: WindowBounds;
	contentRegion: Region;
	points: {
		homeSearchButton: BaseCoordinatePoint;
		launchResultTap: BaseCoordinatePoint;
		appSearchSteps: Record<SupportedApp, string>;
	};
}

export const LOG_PREFIX = "iphone-mirror-autofill";

export const MIRROR_APP_NAME = "iPhone Mirroring";
export const MIRROR_APP_FALLBACK = "QuickTime Player";

export const INSET_LEFT = 10;
export const INSET_TOP = 48;
export const INSET_RIGHT = 10;
export const INSET_BOTTOM = 10;

export const COORD_SCALE = 1;

export const CHAR_DELAY_SEC = 0.25;
export const APP_OPEN_DELAY_SEC = 1.0;

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

export const CLEAR_MODE = "select_all";
export const BACKSPACE_COUNT = 40;

export const PRINT_WINDOW_DEBUG = (() => {
	const raw = process.env.PRINT_WINDOW_DEBUG;
	if (raw === undefined) return true;
	if (raw === "") return true;
	if (raw === "0") return false;
	if (raw === "false" || raw === "False" || raw === "FALSE") return false;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? true : parsed !== 0;
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

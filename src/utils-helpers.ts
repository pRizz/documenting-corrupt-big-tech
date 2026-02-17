import type { SupportedApp } from "./utils-core";
import {
	ACTION_CALIBRATION_DEFINITIONS,
	APP_FLOW_DEFINITIONS,
	type ActionCalibrationDefinition,
	type ActionContext,
	type AppFlowDefinition,
	LOG_PREFIX,
} from "./utils-core";

export const RELATIVE_TOKEN_RE = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|[0-9]*\.[0-9]+)$/;

export function trim(value: string): string {
	return value.trim();
}

export class CliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliError";
	}
}

export function die(message: string): never {
	throw new CliError(message);
}

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

export const CAPTURE_USE_SEARCH_PASTE_WORKAROUND = (() => {
	const raw = process.env.CAPTURE_USE_SEARCH_PASTE_WORKAROUND;
	if (raw === undefined || raw.length === 0) {
		return false;
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
	if (Number.isFinite(parsed)) {
		return parsed !== 0;
	}
	if (PRINT_WINDOW_DEBUG) {
		console.error(`[${LOG_PREFIX}] Invalid CAPTURE_USE_SEARCH_PASTE_WORKAROUND='${raw}', using default false.`);
	}
	return false;
})();

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
	return ACTION_CALIBRATION_DEFINITIONS.some(
		(definition) => definition.id === `${app}:${trim(rawAction)}`,
	);
}

export function parseActionId(actionId: string): { app: SupportedApp; action: string } {
	const [rawApp, rawAction, ...rest] = actionId.split(":");
	if (rawApp === undefined || rawAction === undefined || rest.length > 0) {
		die(`Invalid action id '${actionId}'. Expected app:action format.`);
	}

	const app = trim(rawApp).toLowerCase();
	if (app !== "chrome" && app !== "instagram" && app !== "tiktok") {
		die(`Unknown app '${app}' in action id '${actionId}'.`);
	}

	const action = trim(rawAction);
	if (action.length === 0) {
		die(`Invalid action id '${actionId}'. Expected app:action format.`);
	}

	return { app: app as SupportedApp, action };
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
		die(
			`Unknown action '${rawApp.toLowerCase()}:${rawAction}'. Supported actions: ${ACTION_CALIBRATION_DEFINITIONS.map(
				(definition) => definition.id,
			).join(", ")}`,
		);
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

export function getAppFlowDefinition(app: SupportedApp): AppFlowDefinition {
	return APP_FLOW_DEFINITIONS[app];
}

export function getCalibratableActionsForContext(context: ActionContext): ActionCalibrationDefinition[] {
	return ACTION_CALIBRATION_DEFINITIONS.filter((definition) => definition.autoNavigateTo === context);
}

export function formatUsage(): string {
	return `Usage:\n  bun run capture -- --query \"pizza\" --apps chrome,instagram,tiktok [--out ./outdir]\n\n\tModes:\n\t  --query \"text\"         Required search text to type one character at a time\n\t  --apps \"a,b,c\"         Required app list (chrome,instagram,tiktok) any subset\n\t  --out path             Optional output folder (defaults to ./autofill_shots_YYYYmmdd_HHMMSS)\n\n\tUtility:\n\t  --print-window         Print iPhone mirroring window bounds and computed content bounds\n\t  --calibrate            Interactive calibrate: capture Search button coordinate from mouse and write calibration/base-coordinates.json\n\t  --calibrate-action KEY  Calibrate an app action coordinate. Key format: app:action\n\t                        Supported: chrome:searchBar, chrome:ellipsis, chrome:newIncognitoTab, chrome:searchIcon, chrome:homeIcon, instagram:searchIcon, instagram:homeIcon, tiktok:searchIcon, tiktok:homeIcon\n\t  --calibrate-all         Interactive calibrate all supported action points in one pass\n\t  --debug-calibrate-all   Interactive checkpointed calibrate-all with pass/fail prompts and failure reports\n\t  --coord-to-rel X Y     Convert absolute screen coordinates to relative (0..1)\n\t  --point-check RX RY     Validate relative-to-absolute conversion for debug\n\t  -h, --help             Print this help text\n\n\tRequirements:\n\t  - macOS\n\t  - iPhone Mirroring open and visible\n\t  - Accessibility + Screen Recording for your terminal app\n\t  - Commands: osascript, cliclick, screencapture, awk`;
}

export function mirroringConnectionHint(): void {
	console.error("If the phone is not actively mirrored, complete the iPhone Mirroring connection flow on-screen:");
	console.error(" - In iPhone Mirroring on macOS, select your iPhone");
	console.error(" - Accept any pairing prompt and enter the passcode on your iPhone if requested");
	console.error(" - Tap \"Connect\" (or equivalent) to establish the Mirroring session");
	console.error(" - Wait until the phone UI is visible in the window before rerunning this script");
	console.error(" - If the UI is visible but automation still fails, verify:");
	console.error("   - Prefer using the macOS Terminal.app for initial Automation/Accessibility permission prompts");
	console.error("   - System Settings > Privacy & Security > Accessibility includes your terminal app");
	console.error("   - System Settings > Privacy & Security > Automation allows your terminal app to control System Events and iPhone Mirroring");
}

export function failWithConnectionHint(message: string): never {
	console.error(`error: ${message}`);
	mirroringConnectionHint();
	die(message);
}

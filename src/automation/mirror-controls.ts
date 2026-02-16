import { asCommandResult, runOsa } from "./command-bridge";
import { MIRROR_APP_FALLBACK, MIRROR_APP_NAME, PRINT_WINDOW_DEBUG, failWithConnectionHint, logPayload, logStep } from "../utils";
import { die, sleep } from "../utils";
import { logAction, sleepAfterAction } from "./timing";
import { trim } from "../utils";

export function getFrontmostProcess(this: { runOsa?: (value: string) => string }): string {
	const script = `
\ttell application "System Events"
\t  try
\t    return (name of first process whose frontmost is true as text)
\t  on error
\t    return "unknown"
\t  end try
\tend tell
\t`.trim();

	try {
		return runOsa(script);
	} catch {
		return "unknown";
	}
}

export function logFrontmostState(this: { getFrontmostProcess: () => string; scanForMirrorWindowBounds: (silent?: boolean) => string }, phase: string): void {
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

export function focusMirroring(this: { logFrontmostState: (phase: string) => void; }): void {
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

export async function ensureMirrorFrontmost(this: {
	getFrontmostProcess: () => string;
	focusMirroring: () => void;
	logFrontmostState?: (phase: string) => void;
}, phase: string): Promise<boolean> {
	logAction(`ensureMirrorFrontmost(${phase}): start`);
	for (let attempt = 1; attempt <= 6; attempt += 1) {
		const frontProcess = this.getFrontmostProcess();
		logAction(`ensureMirrorFrontmost(${phase}): attempt ${attempt}/6 frontmost=${frontProcess}`);
		if (frontProcess === MIRROR_APP_NAME || frontProcess === MIRROR_APP_FALLBACK) {
			logAction(`ensureMirrorFrontmost(${phase}): success on attempt ${attempt}`);
			return true;
		}

		this.focusMirroring();
		await sleepAfterAction("frontmost-retry");
	}

	const frontProcess = this.getFrontmostProcess();
	logAction(`ensureMirrorFrontmost(${phase}): failed, final frontmost=${frontProcess}`);
	return false;
}

export async function sendHostKeystroke(
	this: {
		ensureMirrorFrontmost: (context: string) => Promise<boolean>;
		focusMirroring: () => void;
	},
	keyText: string,
	modifiersRaw = "",
	context = "keystroke",
): Promise<boolean> {
	logAction(`sendHostKeystroke(${context}): key='${keyText}' modifiers='${modifiersRaw}'`);
	if (!keyText) {
		die(`send_host_keystroke(${context}) requires a key text`);
	}

	if (!(await this.ensureMirrorFrontmost(context))) {
		logAction(`sendHostKeystroke(${context}): mirror host was not frontmost before send`);
		return false;
	}

	const normalizedKey = trim(keyText).toLowerCase();
	const isReturn = normalizedKey === "return" || normalizedKey === "enter" || normalizedKey === "↩" || normalizedKey === "\n" || normalizedKey === "\r";
	const modifierTokens = trim(modifiersRaw).split(",").map((token) => token.trim()).filter((token) => token.length > 0);
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
				modifierStatements.push("option down");
				break;
			case "shift":
				modifierStatements.push("shift down");
				break;
			default:
				die(`Unsupported modifier token '${token}' in send_host_keystroke(${context})`);
		}
	}

	if (isReturn && modifierStatements.length > 0) {
		die(`send_host_keystroke(${context}) does not support modifiers for return/enter keys`);
	}

	const escaped = keyText.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
	const modifierPayload = modifierStatements.join(", ");
	const script = isReturn
		? `tell application "System Events" to key code 36`
		: modifierPayload
			? `tell application "System Events" to keystroke "${escaped}" using {${modifierPayload}}`
			: `tell application "System Events" to keystroke "${escaped}"`;

	try {
		runOsa(script);
		logAction(`sendHostKeystroke(${context}): script dispatched`);
	} catch {
		logAction(`sendHostKeystroke(${context}): key event failed`);
		return false;
	}

	if (!(await this.ensureMirrorFrontmost(`${context}:post`))) {
		logAction(`sendHostKeystroke(${context}): post-check failed, re-focusing host`);
		this.focusMirroring();
		await sleep(0.2);
		await sleepAfterAction("post-keystroke-focus-restore");
		if (!(await this.ensureMirrorFrontmost(`${context}:post-retry`))) {
			die(`Could not return mirroring host to frontmost after keystroke.`);
		}
	}

	logAction(`sendHostKeystroke(${context}): sent '${keyText}' with modifiers='${modifierPayload}'`);
	return true;
}

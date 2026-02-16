import { type SupportedApp } from "../utils";
import { BACKSPACE_COUNT, CHAR_DELAY_SEC, CLEAR_MODE, die, logStep, type Region } from "../utils";
import { asCommandResult } from "./command-bridge";
import { logPayload } from "../utils";
import { escapeTapText, parseTapSteps, relToAbs, validateRelativePair } from "./geometry";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sleepAfterAction } from "./timing";

interface InteractionHost {
	ensureMirrorFrontmost: (label: string) => Promise<boolean>;
	getContentRegion: () => Region;
	sendHostKeystroke: (key: string, modifiers: string, context: string) => Promise<boolean>;
	screenshotContent: (out: string) => void;
}

export function runCliclick(this: InteractionHost, payload: string): void {
	const result = asCommandResult("cliclick", [payload]);
	if (result.exitCode !== 0) {
		die(`cliclick command failed for '${payload}': ${result.output?.trim()}`);
	}
}

export async function applyAbsClickPoint(
	host: InteractionHost,
	rx: number,
	ry: number,
	event = "c",
	label = "point",
): Promise<[number, number]> {
	if (!(await host.ensureMirrorFrontmost(`apply-abs-click-${label}`))) {
		die(`Failed to ensure mirroring host is frontmost for ${label}`);
	}
	validateRelativePair(rx, ry, label);
	const region = host.getContentRegion();
	const [ax, ay] = relToAbs(rx, ry, region) as [number, number];
	const abs: [number, number] = [ax, ay];
	if (ax < region.x || ax > region.x + region.width || ay < region.y || ay > region.y + region.height) {
		logStep(`apply_abs_click_point(${label}): point is outside computed content (${region.x},${region.y},${region.width},${region.height})`);
	}
	runCliclick.call(host, `${event}:${ax},${ay}`);
	return abs;
}

export async function clickRel(host: InteractionHost, rx: number, ry: number): Promise<void> {
	await applyAbsClickPoint(host, rx, ry, "c", "click");
}

export async function dragRel(
	host: InteractionHost,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): Promise<void> {
	const [sx, sy] = await applyAbsClickPoint(host, startX, startY, "dd", "drag-start");
	const [ex, ey] = await applyAbsClickPoint(host, endX, endY, "m", "drag-end-move");
	logStep(`drag_rel: absolute start ${sx},${sy} end ${ex},${ey}`);
	runCliclick.call(host, `du:${ex},${ey}`);
}

export async function tapSequence(host: InteractionHost, steps: string): Promise<void> {
	if (!(await host.ensureMirrorFrontmost("tap-sequence"))) {
		die("Could not ensure mirror host before tap sequence.");
	}
	const parsedSteps = parseTapSteps(steps, "tap sequence");
	for (const [x, y] of parsedSteps) {
		await clickRel(host, x, y);
		await sleepAfterAction("tap-sequence-step");
	}
}

export function screenshotContent(host: InteractionHost, out: string): void {
	mkdirSync(dirname(out), { recursive: true });
	const region = host.getContentRegion();
	const args = ["-x", "-R", `${region.x},${region.y},${region.width},${region.height}`, out];
	const result = asCommandResult("screencapture", args);
	if (result.exitCode !== 0) {
		die(`Failed to write screenshot '${out}': ${result.output.trim()}`);
	}
}

export async function clearField(host: InteractionHost): Promise<void> {
	if (!(await host.ensureMirrorFrontmost("clear-field"))) {
		die("Could not guarantee mirroring host is frontmost before clearing search.");
	}
	const clearMode = String(CLEAR_MODE);
	if (clearMode === "select_all") {
		if (await host.sendHostKeystroke("a", "command", "select_all")) {
			runCliclick.call(host, "kp:delete");
		} else {
			logPayload("clear_field: select-all failed, falling back to backspace-mode", "");
			const fallbackCount = Number.isInteger(BACKSPACE_COUNT) ? BACKSPACE_COUNT : 40;
			for (let index = 0; index < fallbackCount; index += 1) {
				runCliclick.call(host, "kp:delete");
			}
		}
		return;
	}

	if (clearMode.startsWith("backspace:")) {
		const rawCount = clearMode.slice("backspace:".length);
		const count = Number(rawCount);
		if (!Number.isInteger(count) || count < 0) {
			die(`Invalid CLEAR_MODE backspace count: ${rawCount}`);
		}
		for (let index = 0; index < count; index += 1) {
			runCliclick.call(host, "kp:delete");
		}
		return;
	}

	die(`Unknown CLEAR_MODE: ${CLEAR_MODE}`);
}

export async function typeText(host: InteractionHost, text: string, charDelaySec = CHAR_DELAY_SEC): Promise<void> {
	if (!(await host.ensureMirrorFrontmost("type-text"))) {
		die("Could not ensure mirroring host before typing text.");
	}
	for (const character of text) {
		runCliclick.call(host, `t:${escapeTapText(character)}`);
		const delay = Number.isFinite(charDelaySec) ? charDelaySec : CHAR_DELAY_SEC;
		await new Promise((resolve) => setTimeout(resolve, delay * 1000));
	}
}

export async function typeAndCapturePerChar(
	host: InteractionHost,
	_app: SupportedApp,
	query: string,
	outdir: string,
	querySlug: string,
): Promise<void> {
	const appDir = outdir;
	mkdirSync(appDir, { recursive: true });
	hostScreenshot(host, appDir, _app, querySlug, "00_empty");
	for (let index = 0; index < query.length; index += 1) {
		if (!(await host.ensureMirrorFrontmost(`type-char-${_app}`))) {
			die(`Could not ensure mirror host during character typing at index ${index}.`);
		}
		const ch = query.charAt(index);
		runCliclick.call(host, `t:${escapeTapText(ch)}`);
		await new Promise((resolve) => setTimeout(resolve, CHAR_DELAY_SEC * 1000));
		const prefix = String(index + 1).padStart(2, "0");
		hostScreenshot(host, appDir, _app, querySlug, prefix);
	}
}

function hostScreenshot(host: InteractionHost, appDir: string, app: SupportedApp, querySlug: string, prefix: string): void {
	host.screenshotContent(`${appDir}/${app}_${prefix}_${querySlug}.png`);
}

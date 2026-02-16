import { die, logPayload, type Region } from "../../utils";
import { needCmd } from "../command-bridge";
import {
	ensureMirrorFrontmost,
	focusMirroring,
	getFrontmostProcess,
	logFrontmostState,
	sendHostKeystroke,
} from "../mirror-controls";
import {
	getMirrorWindowBounds,
	printMirrorDebugProbe,
	queryFrontmostWindowBounds,
	queryProcessBounds,
	scanForMirrorWindowBounds,
} from "../mirror-window";
import { absToRel as absToRelWithRegion, getContentRegion as getContentRegionFromBounds, relToAbs as relToAbsWithRegion } from "../geometry";
import {
	applyAbsClickPoint,
	clearField,
	clickRel,
	dragRel,
	runCliclick,
	screenshotContent,
	tapSequence,
	typeAndCapturePerChar,
	typeText,
} from "../interaction";
import type { FlowRuntimeContext } from "../types";

export interface AutomationSession {
	runOsa?: (value: string) => string;
	state: FlowRuntimeContext;
	getFrontmostProcess(): string;
	logFrontmostState(phase: string): void;
	focusMirroring(): void;
	ensureMirrorFrontmost(phase: string): Promise<boolean>;
	sendHostKeystroke(keyText: string, modifiersRaw?: string, context?: string): Promise<boolean>;
	queryProcessBounds(processName: string): string;
	queryFrontmostWindowBounds(): string;
	printMirrorDebugProbe(): void;
	scanForMirrorWindowBounds(silent?: boolean): string;
	getMirrorWindowBounds(): string;
	getContentRegion(bounds?: string): Region;
	relToAbs(rx: number, ry: number): [number, number];
	absToRel(ax: number, ay: number): [number, number];
	runCliclick(payload: string): void;
	applyAbsClickPoint(rx: number, ry: number, event?: string, label?: string): Promise<[number, number]>;
	clickRel(rx: number, ry: number): Promise<void>;
	dragRel(startX: number, startY: number, endX: number, endY: number): Promise<void>;
	tapSequence(steps: string): Promise<void>;
	screenshotContent(out: string): void;
	clearField(): Promise<void>;
	typeText(text: string, charDelaySec?: number): Promise<void>;
	typeAndCapturePerChar(app: import("../../utils").SupportedApp, query: string, outdir: string, querySlug: string): Promise<void>;
	ensurePreflightChecks(): void;
}

export function createAutomationSession(initialState: FlowRuntimeContext = {}): AutomationSession {
	const state: FlowRuntimeContext = {
		calibrationProfile: initialState.calibrationProfile,
		currentApp: initialState.currentApp,
		currentLabel: initialState.currentLabel,
	};

	const session: AutomationSession = {
		state,
		getFrontmostProcess(): string {
			return getFrontmostProcess.call(session);
		},
		logFrontmostState(phase: string): void {
			logFrontmostState.call(session, phase);
		},
		focusMirroring(): void {
			focusMirroring.call(session);
		},
		ensureMirrorFrontmost(phase: string): Promise<boolean> {
			return ensureMirrorFrontmost.call(session, phase);
		},
		sendHostKeystroke(keyText: string, modifiersRaw = "", context = "keystroke"): Promise<boolean> {
			return sendHostKeystroke.call(session, keyText, modifiersRaw, context);
		},
		queryProcessBounds(processName: string): string {
			return queryProcessBounds.call(session, processName);
		},
		queryFrontmostWindowBounds(): string {
			return queryFrontmostWindowBounds.call(session);
		},
		printMirrorDebugProbe(): void {
			printMirrorDebugProbe.call(session);
		},
		scanForMirrorWindowBounds(silent = false): string {
			return scanForMirrorWindowBounds.call(session, silent);
		},
		getMirrorWindowBounds(): string {
			return getMirrorWindowBounds.call(session);
		},
		getContentRegion(bounds?: string): Region {
			const mirrorBounds = bounds ?? session.getMirrorWindowBounds();
			return getContentRegionFromBounds(mirrorBounds);
		},
		relToAbs(rx: number, ry: number): [number, number] {
			const region = session.getContentRegion();
			logPayload("rel_to_abs region", `x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);
			const [absX, absY] = relToAbsWithRegion(rx, ry, region);
			logPayload("rel_to_abs raw output", `${absX}|${absY}`);
			return [absX, absY];
		},
		absToRel(ax: number, ay: number): [number, number] {
			const region = session.getContentRegion();
			logPayload("abs_to_rel region", `x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);
			if (region.width === 0 || region.height === 0) {
				die(`Invalid content region while converting abs (${ax}, ${ay})`);
			}
			return absToRelWithRegion(ax, ay, region);
		},
		runCliclick(payload: string): void {
			runCliclick.call(session, payload);
		},
		applyAbsClickPoint(rx: number, ry: number, event = "c", label = "point"): Promise<[number, number]> {
			return applyAbsClickPoint(session, rx, ry, event, label);
		},
		clickRel(rx: number, ry: number): Promise<void> {
			return clickRel(session, rx, ry);
		},
		dragRel(startX: number, startY: number, endX: number, endY: number): Promise<void> {
			return dragRel(session, startX, startY, endX, endY);
		},
		tapSequence(steps: string): Promise<void> {
			return tapSequence(session, steps);
		},
		screenshotContent(out: string): void {
			screenshotContent(session, out);
		},
		clearField(): Promise<void> {
			return clearField(session);
		},
		typeText(text: string, charDelaySec?: number): Promise<void> {
			return typeText(session, text, charDelaySec);
		},
		typeAndCapturePerChar(app: import("../../utils").SupportedApp, query: string, outdir: string, querySlug: string): Promise<void> {
			return typeAndCapturePerChar(session, app, query, outdir, querySlug);
		},
		ensurePreflightChecks(): void {
			needCmd("osascript", "This command is built into macOS.");
			needCmd("awk", "This command is built into macOS.");
			needCmd("cliclick", "brew install cliclick");
			needCmd("screencapture", "This command is built into macOS.");
		},
	};

	return session;
}

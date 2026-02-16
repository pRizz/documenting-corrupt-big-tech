import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPTURE_USE_MIRROR_SHORTCUTS, PRINT_WINDOW_DEBUG, timestampSnapshot, type Region, type WindowBounds } from "../../utils";
import type { RuntimeAppContext } from "../types";
import type { CalibrateAllStepDescriptor, CalibrateAllStepRuntimeState } from "./calibration";
import type { AppLaunchDebugStep, AppLaunchStepFocusProbe } from "./app-launch-debug";
import type { AutomationSession } from "./session";

export interface StepSnapshot {
	index: number;
	total: number;
	id: string;
	kind: string;
	label: string;
	expected: string;
	definitionId?: string;
	app?: string;
	action?: string;
	targetContext?: string;
}

export interface LaunchSubStepSnapshot {
	displayIndex: string;
	id: string;
	kind: string;
	label: string;
	expected: string;
	app: string;
	mainStepId: string;
	mainStepLabel: string;
	attemptNumber?: number;
	attemptMode?: string;
	contextHint: string;
	ensurePhase?: string;
	ensuredFrontmost?: boolean;
	frontmostBeforeFocus?: string;
	frontmostAfterFocus?: string;
	frontmostBeforeAction?: string;
	frontmostAfterAction?: string;
}

export interface StateSnapshot {
	runtimeContext: RuntimeAppContext;
	contentRegion?: Region;
	mirrorWindow?: WindowBounds;
	currentDefinitionId?: string;
}

interface ProbeSnapshot {
	frontmostProcess?: string;
	frontmostWindowBounds?: string;
	mirrorBoundsScan?: string;
	mirrorBoundsDirect?: string;
	contentRegion?: Region;
	errors: string[];
}

interface ErrorSnapshot {
	name: string;
	message: string;
	stack?: string;
}

export interface DebugCalibrateFailureReport {
	timestamp: string;
	mode: "debug-calibrate-all";
	failureKind: "operator-fail" | "runtime-error";
	operatorVerdict: "pass" | "fail" | "not-recorded";
	mainStep?: StepSnapshot;
	subStep?: LaunchSubStepSnapshot;
	runtimeState?: StateSnapshot;
	probes: ProbeSnapshot;
	env: {
		CAPTURE_USE_MIRROR_SHORTCUTS: boolean;
		PRINT_WINDOW_DEBUG: boolean;
		raw: {
			CAPTURE_USE_MIRROR_SHORTCUTS?: string;
			PRINT_WINDOW_DEBUG?: string;
		};
	};
	error: ErrorSnapshot;
}

function cloneRuntimeContext(context: RuntimeAppContext): RuntimeAppContext {
	return {
		currentApp: context.currentApp,
		currentContext: context.currentContext,
	};
}

function cloneRegion(region?: Region): Region | undefined {
	if (!region) {
		return undefined;
	}
	return {
		x: region.x,
		y: region.y,
		width: region.width,
		height: region.height,
	};
}

function cloneWindowBounds(bounds?: WindowBounds): WindowBounds | undefined {
	if (!bounds) {
		return undefined;
	}
	return {
		x1: bounds.x1,
		y1: bounds.y1,
		x2: bounds.x2,
		y2: bounds.y2,
	};
}

export function cloneStep(step: CalibrateAllStepDescriptor): StepSnapshot {
	return {
		index: step.index,
		total: step.total,
		id: step.id,
		kind: step.kind,
		label: step.label,
		expected: step.expected,
		definitionId: step.definitionId,
		app: step.app,
		action: step.action,
		targetContext: step.targetContext,
	};
}

export function cloneState(state: CalibrateAllStepRuntimeState): StateSnapshot {
	return {
		runtimeContext: cloneRuntimeContext(state.runtimeContext),
		contentRegion: cloneRegion(state.contentRegion),
		mirrorWindow: cloneWindowBounds(state.mirrorWindow),
		currentDefinitionId: state.currentDefinitionId,
	};
}

export function buildLaunchSubStepSnapshot(
	mainStep: StepSnapshot,
	subIndex: number,
	step: AppLaunchDebugStep,
	focusProbe?: AppLaunchStepFocusProbe,
): LaunchSubStepSnapshot {
	return {
		displayIndex: `${mainStep.index}.${subIndex}`,
		id: step.id,
		kind: step.kind,
		label: step.label,
		expected: step.expected,
		app: step.app,
		mainStepId: mainStep.id,
		mainStepLabel: mainStep.label,
		attemptNumber: step.attemptNumber,
		attemptMode: step.attemptMode,
		contextHint: step.contextHint,
		ensurePhase: focusProbe?.ensurePhase,
		ensuredFrontmost: focusProbe?.ensuredFrontmost,
		frontmostBeforeFocus: focusProbe?.frontmostBeforeFocus,
		frontmostAfterFocus: focusProbe?.frontmostAfterFocus,
		frontmostBeforeAction: focusProbe?.frontmostBeforeAction,
		frontmostAfterAction: focusProbe?.frontmostAfterAction,
	};
}

function toErrorSnapshot(error: unknown): ErrorSnapshot {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return {
		name: "UnknownError",
		message: String(error),
	};
}

function captureProbeSnapshot(session: AutomationSession, state?: StateSnapshot): ProbeSnapshot {
	const errors: string[] = [];
	const probe: ProbeSnapshot = { errors };
	try {
		probe.frontmostProcess = session.getFrontmostProcess();
	} catch (error) {
		errors.push(`frontmostProcess: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		probe.frontmostWindowBounds = session.queryFrontmostWindowBounds();
	} catch (error) {
		errors.push(`frontmostWindowBounds: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		probe.mirrorBoundsScan = session.scanForMirrorWindowBounds(true);
	} catch (error) {
		errors.push(`mirrorBoundsScan: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		probe.mirrorBoundsDirect = session.getMirrorWindowBounds();
	} catch (error) {
		errors.push(`mirrorBoundsDirect: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (state?.contentRegion) {
		probe.contentRegion = cloneRegion(state.contentRegion);
		return probe;
	}
	if (!probe.mirrorBoundsDirect) {
		return probe;
	}
	try {
		probe.contentRegion = session.getContentRegion(probe.mirrorBoundsDirect);
	} catch (error) {
		errors.push(`contentRegionFromBounds: ${error instanceof Error ? error.message : String(error)}`);
	}
	return probe;
}

export function buildFailureReport(args: {
	error: unknown;
	session: AutomationSession;
	failureKind: "operator-fail" | "runtime-error";
	operatorVerdict: "pass" | "fail" | "not-recorded";
	mainStep?: StepSnapshot;
	subStep?: LaunchSubStepSnapshot;
	state?: StateSnapshot;
}): DebugCalibrateFailureReport {
	return {
		timestamp: new Date().toISOString(),
		mode: "debug-calibrate-all",
		failureKind: args.failureKind,
		operatorVerdict: args.operatorVerdict,
		mainStep: args.mainStep,
		subStep: args.subStep,
		runtimeState: args.state,
		probes: captureProbeSnapshot(args.session, args.state),
		env: {
			CAPTURE_USE_MIRROR_SHORTCUTS,
			PRINT_WINDOW_DEBUG,
			raw: {
				CAPTURE_USE_MIRROR_SHORTCUTS: process.env.CAPTURE_USE_MIRROR_SHORTCUTS,
				PRINT_WINDOW_DEBUG: process.env.PRINT_WINDOW_DEBUG,
			},
		},
		error: toErrorSnapshot(args.error),
	};
}

export function writeFailureReport(report: DebugCalibrateFailureReport): string {
	const reportPath = resolve(`./calibration/debug-reports/debug-calibrate-all-failure-${timestampSnapshot()}.json`);
	mkdirSync(resolve("./calibration/debug-reports"), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return reportPath;
}

export function printFailureSummary(report: DebugCalibrateFailureReport, reportPath: string): void {
	console.error("");
	console.error("[debug-calibrate-all] Failure detected.");
	if (report.subStep) {
		console.error(`[debug-calibrate-all] Sub-step: ${report.subStep.displayIndex} (${report.subStep.id})`);
		console.error(`[debug-calibrate-all] Expected: ${report.subStep.expected}`);
		if (report.subStep.ensurePhase) {
			console.error(`[debug-calibrate-all] Launch focus phase: ${report.subStep.ensurePhase}`);
		}
		if (typeof report.subStep.ensuredFrontmost === "boolean") {
			console.error(`[debug-calibrate-all] Launch focus ensured: ${String(report.subStep.ensuredFrontmost)}`);
		}
		if (report.subStep.frontmostBeforeFocus) {
			console.error(`[debug-calibrate-all] Launch frontmost before focus: ${report.subStep.frontmostBeforeFocus}`);
		}
		if (report.subStep.frontmostAfterFocus) {
			console.error(`[debug-calibrate-all] Launch frontmost after focus: ${report.subStep.frontmostAfterFocus}`);
		}
		if (report.subStep.frontmostBeforeAction) {
			console.error(`[debug-calibrate-all] Launch frontmost before action: ${report.subStep.frontmostBeforeAction}`);
		}
		if (report.subStep.frontmostAfterAction) {
			console.error(`[debug-calibrate-all] Launch frontmost after action: ${report.subStep.frontmostAfterAction}`);
		}
	} else if (report.mainStep) {
		console.error(`[debug-calibrate-all] Step: ${report.mainStep.index}/${report.mainStep.total} (${report.mainStep.id})`);
		console.error(`[debug-calibrate-all] Expected: ${report.mainStep.expected}`);
	}
	console.error(`[debug-calibrate-all] Failure kind: ${report.failureKind}`);
	console.error(`[debug-calibrate-all] Operator verdict: ${report.operatorVerdict}`);
	if (report.probes.frontmostProcess) {
		console.error(`[debug-calibrate-all] Frontmost process: ${report.probes.frontmostProcess}`);
	}
	if (report.probes.mirrorBoundsScan) {
		console.error(`[debug-calibrate-all] Mirror bounds scan: ${report.probes.mirrorBoundsScan}`);
	}
	if (report.probes.errors.length > 0) {
		console.error(`[debug-calibrate-all] Probe warnings: ${report.probes.errors.join(" | ")}`);
	}
	console.error(`[debug-calibrate-all] Report saved: ${reportPath}`);
}

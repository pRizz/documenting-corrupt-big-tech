import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { CAPTURE_USE_MIRROR_SHORTCUTS, PRINT_WINDOW_DEBUG, timestampSnapshot, type Region, type WindowBounds } from "../../utils";
import type { RuntimeAppContext } from "../types";
import {
	runCalibrateAllWorkflow,
	type CalibrateAllStepDescriptor,
	type CalibrateAllStepHooks,
	type CalibrateAllStepRuntimeState,
} from "./calibration";
import type { AutomationSession } from "./session";

interface StepSnapshot {
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

interface StateSnapshot {
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

interface DebugCalibrateFailureReport {
	timestamp: string;
	mode: "debug-calibrate-all";
	failureKind: "operator-fail" | "runtime-error";
	operatorVerdict: "pass" | "fail" | "not-recorded";
	step?: StepSnapshot;
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

class OperatorMarkedStepFailedError extends Error {
	readonly step: StepSnapshot;
	readonly state: StateSnapshot;

	constructor(step: StepSnapshot, state: StateSnapshot) {
		super(`Operator marked step ${step.index}/${step.total} (${step.id}) as failed.`);
		this.name = "OperatorMarkedStepFailedError";
		this.step = step;
		this.state = state;
	}
}

function requireInteractiveTerminal(): void {
	if (process.stdin.isTTY && process.stdout.isTTY) {
		return;
	}
	throw new Error("debug-calibrate-all requires an interactive TTY (stdin/stdout).");
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

function cloneStep(step: CalibrateAllStepDescriptor): StepSnapshot {
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

function cloneState(state: CalibrateAllStepRuntimeState): StateSnapshot {
	return {
		runtimeContext: cloneRuntimeContext(state.runtimeContext),
		contentRegion: cloneRegion(state.contentRegion),
		mirrorWindow: cloneWindowBounds(state.mirrorWindow),
		currentDefinitionId: state.currentDefinitionId,
	};
}

async function promptLine(prompt: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		let settled = false;

		const finish = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			rl.close();
			callback();
		};

		rl.question(prompt, (answer) => {
			finish(() => resolve(answer));
		});

		rl.on("SIGINT", () => {
			finish(() => reject(new Error("debug-calibrate-all canceled by user.")));
		});
	});
}

async function waitForEnter(step: StepSnapshot): Promise<void> {
	console.log("");
	console.log(`[debug-calibrate-all] Step ${step.index}/${step.total}: ${step.label}`);
	console.log(`[debug-calibrate-all] Step ID: ${step.id}`);
	console.log(`[debug-calibrate-all] Expected next action: ${step.expected}`);
	await promptLine("[debug-calibrate-all] Press Enter to execute this step... ");
}

async function promptVerdict(step: StepSnapshot): Promise<"pass" | "fail"> {
	while (true) {
		const answer = (await promptLine(`[debug-calibrate-all] Step ${step.index}/${step.total} result? (p=pass, f=fail): `))
			.trim()
			.toLowerCase();
		if (answer === "p") {
			return "pass";
		}
		if (answer === "f") {
			return "fail";
		}
		console.log("[debug-calibrate-all] Invalid input. Enter 'p' for pass or 'f' for fail.");
	}
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

function buildFailureReport(
	error: unknown,
	session: AutomationSession,
	step?: StepSnapshot,
	state?: StateSnapshot,
	operatorVerdict: "pass" | "fail" | "not-recorded" = "not-recorded",
): DebugCalibrateFailureReport {
	return {
		timestamp: new Date().toISOString(),
		mode: "debug-calibrate-all",
		failureKind: error instanceof OperatorMarkedStepFailedError ? "operator-fail" : "runtime-error",
		operatorVerdict,
		step,
		runtimeState: state,
		probes: captureProbeSnapshot(session, state),
		env: {
			CAPTURE_USE_MIRROR_SHORTCUTS,
			PRINT_WINDOW_DEBUG,
			raw: {
				CAPTURE_USE_MIRROR_SHORTCUTS: process.env.CAPTURE_USE_MIRROR_SHORTCUTS,
				PRINT_WINDOW_DEBUG: process.env.PRINT_WINDOW_DEBUG,
			},
		},
		error: toErrorSnapshot(error),
	};
}

function writeFailureReport(report: DebugCalibrateFailureReport): string {
	const reportPath = resolve(`./calibration/debug-reports/debug-calibrate-all-failure-${timestampSnapshot()}.json`);
	mkdirSync(resolve("./calibration/debug-reports"), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return reportPath;
}

function printFailureSummary(report: DebugCalibrateFailureReport, reportPath: string): void {
	console.error("");
	console.error("[debug-calibrate-all] Failure detected.");
	if (report.step) {
		console.error(`[debug-calibrate-all] Step: ${report.step.index}/${report.step.total} (${report.step.id})`);
		console.error(`[debug-calibrate-all] Expected: ${report.step.expected}`);
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

export async function debugCalibrateAll(session: AutomationSession): Promise<void> {
	requireInteractiveTerminal();
	console.log("[debug-calibrate-all] Starting checkpointed calibration run.");

	let latestStep: StepSnapshot | undefined;
	let latestState: StateSnapshot | undefined;
	let operatorVerdict: "pass" | "fail" | "not-recorded" = "not-recorded";

	const hooks: CalibrateAllStepHooks = {
		beforeStep: async (step, state) => {
			latestStep = cloneStep(step);
			latestState = cloneState(state);
			operatorVerdict = "not-recorded";
			await waitForEnter(latestStep);
		},
		afterStep: async (step, state) => {
			latestStep = cloneStep(step);
			latestState = cloneState(state);
			const verdict = await promptVerdict(latestStep);
			if (verdict === "pass") {
				operatorVerdict = "pass";
				return;
			}
			operatorVerdict = "fail";
			throw new OperatorMarkedStepFailedError(latestStep, latestState);
		},
		onStepError: async (step, _error, state) => {
			latestStep = cloneStep(step);
			latestState = cloneState(state);
		},
	};

	try {
		await runCalibrateAllWorkflow(session, hooks);
		console.log("[debug-calibrate-all] Completed successfully.");
	} catch (error) {
		const report = buildFailureReport(error, session, latestStep, latestState, operatorVerdict);
		const reportPath = writeFailureReport(report);
		printFailureSummary(report, reportPath);

		if (error instanceof OperatorMarkedStepFailedError) {
			throw new Error(`debug-calibrate-all stopped after operator-marked failure. Report: ${reportPath}`);
		}
		throw new Error(`debug-calibrate-all stopped after runtime failure. Report: ${reportPath}`);
	}
}

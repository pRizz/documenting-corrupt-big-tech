import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { CAPTURE_FAST_STEP_GAP_SEC } from "../../utils";
import { asCommandResult } from "../command-bridge";
import { sleepAfterAction } from "../timing";
import {
	buildFailureReport,
	buildLaunchSubStepSnapshot,
	cloneState,
	cloneStep,
	printFailureSummary,
	writeFailureReport,
	type LaunchSubStepSnapshot,
	type StateSnapshot,
	type StepSnapshot,
} from "./calibration-debug-report";
import {
	runCalibrateAllWorkflow,
	type CalibrateAllStepHooks,
} from "./calibration";
import type { AutomationSession } from "./session";
import type { AppLaunchDebugHooks, AppLaunchDebugStep, AppLaunchStepFocusProbe } from "./app-launch-debug";

const DEBUG_CHECKPOINT_DIR = resolve("./calibration/debug-checkpoints");
const DEBUG_RESUME_BUTTON_REL_X = 0.5;
const DEBUG_RESUME_BUTTON_REL_Y = 0.58;
const DEBUG_TOUCHID_WAIT_TIMEOUT_SEC = 25;

class OperatorMarkedStepFailedError extends Error {
	readonly mainStep?: StepSnapshot;
	readonly subStep?: LaunchSubStepSnapshot;
	readonly state?: StateSnapshot;

	constructor(mainStep: StepSnapshot, state: StateSnapshot, subStep?: LaunchSubStepSnapshot) {
		super(
			subStep
				? `Operator marked step ${subStep.displayIndex} (${subStep.id}) as failed.`
				: `Operator marked step ${mainStep.index}/${mainStep.total} (${mainStep.id}) as failed.`,
		);
		this.name = "OperatorMarkedStepFailedError";
		this.mainStep = mainStep;
		this.subStep = subStep;
		this.state = state;
	}
}

function requireInteractiveTerminal(): void {
	if (process.stdin.isTTY && process.stdout.isTTY) {
		return;
	}
	throw new Error("debug-calibrate-all requires an interactive TTY (stdin/stdout).");
}

function sanitizeCheckpointToken(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	return sanitized.length > 0 ? sanitized : "step";
}

function shouldUseLaunchSubSteps(step: StepSnapshot, state: StateSnapshot): boolean {
	if (step.kind !== "transition-context") {
		return false;
	}
	if (!step.app || (step.targetContext !== "app-active" && step.targetContext !== "search-focused")) {
		return false;
	}
	return state.runtimeContext.currentApp !== step.app || state.runtimeContext.currentContext !== step.targetContext;
}

interface PromptLineOptions {
	timeoutSec?: number;
	defaultAnswerOnTimeout?: string;
}

type CaptureCheckpointScreenshot = (
	mainStep: StepSnapshot,
	state: StateSnapshot | undefined,
	subStep?: LaunchSubStepSnapshot,
) => Promise<string | undefined>;

function isFocusMirroringStep(step: StepSnapshot): boolean {
	return step.id === "focus-mirroring";
}

async function promptLine(prompt: string, options: PromptLineOptions = {}): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const finish = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
			}
			rl.close();
			callback();
		};
		rl.question(prompt, (answer) => {
			finish(() => resolve(answer));
		});
		if (options.timeoutSec && options.timeoutSec > 0) {
			timeoutId = setTimeout(() => {
				const fallback = options.defaultAnswerOnTimeout ?? "";
				finish(() => resolve(fallback));
			}, options.timeoutSec * 1000);
		}
		rl.on("SIGINT", () => {
			finish(() => reject(new Error("debug-calibrate-all canceled by user.")));
		});
	});
}

async function runMirrorResumeRecoveryIfRequested(
	session: AutomationSession,
	mainStep: StepSnapshot,
	state: StateSnapshot | undefined,
	captureCheckpointScreenshot: CaptureCheckpointScreenshot,
): Promise<void> {
	while (true) {
		const choice = (await promptLine(
			"[debug-calibrate-all] If mirror shows Resume/Locked, type 'r' then Enter to click Resume; otherwise press Enter to continue: ",
		))
			.trim()
			.toLowerCase();
		if (!choice) {
			return;
		}
		if (choice !== "r") {
			console.log("[debug-calibrate-all] Invalid input. Press Enter to skip recovery or type 'r' to run Resume recovery.");
			continue;
		}
		console.log(
			`[debug-calibrate-all] Running mirror recovery click at rel=(${DEBUG_RESUME_BUTTON_REL_X}, ${DEBUG_RESUME_BUTTON_REL_Y})`,
		);
		const ensurePhase = "debug-calibrate-all:resume-recovery";
		if (!(await session.ensureMirrorFrontmost(ensurePhase))) {
			throw new Error("Could not focus iPhone Mirroring before Resume recovery click.");
		}
		await session.clickRel(DEBUG_RESUME_BUTTON_REL_X, DEBUG_RESUME_BUTTON_REL_Y);
		await sleepAfterAction("debug-resume-recovery-click", CAPTURE_FAST_STEP_GAP_SEC);
		const waitResult = await promptLine(
			`[debug-calibrate-all] Use TouchID now, press Enter when done (auto-continue in ${DEBUG_TOUCHID_WAIT_TIMEOUT_SEC}s): `,
			{
				timeoutSec: DEBUG_TOUCHID_WAIT_TIMEOUT_SEC,
				defaultAnswerOnTimeout: "__timeout__",
			},
		);
		if (waitResult === "__timeout__") {
			console.log("[debug-calibrate-all] TouchID wait timed out; continuing recovery flow.");
		}
		const recoveryScreenshotPath = await captureCheckpointScreenshot(mainStep, state);
		if (recoveryScreenshotPath) {
			console.log(`[debug-calibrate-all] Post-recovery checkpoint screenshot: ${recoveryScreenshotPath}`);
		}
		return;
	}
}

async function waitForEnterStep(step: StepSnapshot): Promise<void> {
	console.log("");
	console.log(`[debug-calibrate-all] Step ${step.index}/${step.total}: ${step.label}`);
	console.log(`[debug-calibrate-all] Step ID: ${step.id}`);
	console.log(`[debug-calibrate-all] Expected next action: ${step.expected}`);
	await promptLine("[debug-calibrate-all] Press Enter to execute this step... ");
}

async function waitForEnterSubStep(step: LaunchSubStepSnapshot): Promise<void> {
	console.log("");
	console.log(`[debug-calibrate-all] Step ${step.displayIndex}: ${step.label}`);
	console.log(`[debug-calibrate-all] Sub-step ID: ${step.id}`);
	console.log(`[debug-calibrate-all] Expected next action: ${step.expected}`);
	await promptLine("[debug-calibrate-all] Press Enter to execute this sub-step... ");
}

async function promptVerdict(prefix: string): Promise<"pass" | "fail"> {
	while (true) {
		const answer = (await promptLine(`${prefix} (p=pass, f=fail): `)).trim().toLowerCase();
		if (answer === "p") {
			return "pass";
		}
		if (answer === "f") {
			return "fail";
		}
		console.log("[debug-calibrate-all] Invalid input. Enter 'p' for pass or 'f' for fail.");
	}
}

export async function debugCalibrateAll(session: AutomationSession): Promise<void> {
	requireInteractiveTerminal();
	console.log("[debug-calibrate-all] Starting checkpointed calibration run.");

	let latestMainStep: StepSnapshot | undefined;
	let latestSubStep: LaunchSubStepSnapshot | undefined;
	let latestState: StateSnapshot | undefined;
	let operatorVerdict: "pass" | "fail" | "not-recorded" = "not-recorded";
	let checkpointSequence = 0;

	const captureCheckpointScreenshot = async (
		mainStep: StepSnapshot,
		state: StateSnapshot | undefined,
		subStep?: LaunchSubStepSnapshot,
	): Promise<string | undefined> => {
		checkpointSequence += 1;
		const indexToken = String(checkpointSequence).padStart(3, "0");
		const mainToken = `step-${String(mainStep.index).padStart(2, "0")}-${sanitizeCheckpointToken(mainStep.id)}`;
		const subToken = subStep
			? `-sub-${sanitizeCheckpointToken(subStep.displayIndex)}-${sanitizeCheckpointToken(subStep.id)}`
			: "";
		const screenshotPath = resolve(DEBUG_CHECKPOINT_DIR, `debug-calibrate-all-${indexToken}-${mainToken}${subToken}.png`);
		try {
			mkdirSync(DEBUG_CHECKPOINT_DIR, { recursive: true });
			const ensurePhase = subStep
				? `debug-calibrate-all:checkpoint:${subStep.id}`
				: `debug-calibrate-all:checkpoint:${mainStep.id}`;
			const ensured = await session.ensureMirrorFrontmost(ensurePhase);
			if (!ensured) {
				console.error(`[debug-calibrate-all] Checkpoint screenshot skipped (could not focus mirror): ${ensurePhase}`);
				return undefined;
			}
			const captureArgs = ["-x"];
			if (state?.contentRegion) {
				const region = state.contentRegion;
				captureArgs.push("-R", `${region.x},${region.y},${region.width},${region.height}`);
			}
			captureArgs.push(screenshotPath);
			const captureResult = asCommandResult("screencapture", captureArgs);
			if (captureResult.exitCode !== 0) {
				console.error(
					`[debug-calibrate-all] Failed to capture checkpoint screenshot: ${captureResult.output.trim() || "unknown screencapture error"}`,
				);
				return undefined;
			}
			console.log(`[debug-calibrate-all] Checkpoint screenshot: ${screenshotPath}`);
			return screenshotPath;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[debug-calibrate-all] Failed to capture checkpoint screenshot: ${message}`);
			return undefined;
		}
	};

	const hooks: CalibrateAllStepHooks = {
		beforeStep: async (step, state) => {
			latestMainStep = cloneStep(step);
			latestState = cloneState(state);
			latestSubStep = undefined;
			operatorVerdict = "not-recorded";
			if (shouldUseLaunchSubSteps(latestMainStep, latestState)) {
				return;
			}
			await waitForEnterStep(latestMainStep);
		},
		afterStep: async (step, state) => {
			latestMainStep = cloneStep(step);
			latestState = cloneState(state);
			if (shouldUseLaunchSubSteps(latestMainStep, latestState)) {
				if (operatorVerdict === "not-recorded") {
					operatorVerdict = "pass";
				}
				return;
			}
			if (isFocusMirroringStep(latestMainStep)) {
				await runMirrorResumeRecoveryIfRequested(session, latestMainStep, latestState, captureCheckpointScreenshot);
			}
			const screenshotPath = await captureCheckpointScreenshot(latestMainStep, latestState);
			if (screenshotPath) {
				latestMainStep = {
					...latestMainStep,
					checkpointScreenshotPath: screenshotPath,
				};
			}
			const verdict = await promptVerdict(`[debug-calibrate-all] Step ${latestMainStep.index}/${latestMainStep.total} result?`);
			if (verdict === "pass") {
				operatorVerdict = "pass";
				return;
			}
			operatorVerdict = "fail";
			throw new OperatorMarkedStepFailedError(latestMainStep, latestState);
		},
		onStepError: async (step, _error, state) => {
			latestMainStep = cloneStep(step);
			latestState = cloneState(state);
		},
		buildLaunchDebugHooks: (step, state): AppLaunchDebugHooks | undefined => {
			const mainStep = cloneStep(step);
			const mainState = cloneState(state);
			if (!shouldUseLaunchSubSteps(mainStep, mainState)) {
				return undefined;
			}
			let subIndex = 0;
			const snapshotSubStep = (launchStep: AppLaunchDebugStep, focusProbe?: AppLaunchStepFocusProbe) =>
				buildLaunchSubStepSnapshot(mainStep, Math.max(subIndex, 1), launchStep, focusProbe);
			return {
				beforeStep: async (launchStep) => {
					subIndex += 1;
					latestMainStep = mainStep;
					latestState = mainState;
					latestSubStep = buildLaunchSubStepSnapshot(mainStep, subIndex, launchStep);
					operatorVerdict = "not-recorded";
					await waitForEnterSubStep(latestSubStep);
				},
				afterStep: async (launchStep, focusProbe) => {
					latestMainStep = mainStep;
					latestState = mainState;
					let current = snapshotSubStep(launchStep, focusProbe);
					const screenshotPath = await captureCheckpointScreenshot(mainStep, mainState, current);
					if (screenshotPath) {
						current = {
							...current,
							checkpointScreenshotPath: screenshotPath,
						};
					}
					latestSubStep = current;
					const verdict = await promptVerdict(`[debug-calibrate-all] Step ${current.displayIndex} result?`);
					if (verdict === "pass") {
						operatorVerdict = "pass";
						return;
					}
					operatorVerdict = "fail";
					throw new OperatorMarkedStepFailedError(mainStep, mainState, current);
				},
				onStepError: async (launchStep, _error, focusProbe) => {
					latestMainStep = mainStep;
					latestState = mainState;
					if (!latestSubStep || latestSubStep.id !== launchStep.id) {
						latestSubStep = snapshotSubStep(launchStep, focusProbe);
						return;
					}
					latestSubStep = snapshotSubStep(launchStep, focusProbe);
				},
			};
		},
	};

	try {
		await runCalibrateAllWorkflow(session, hooks);
		console.log("[debug-calibrate-all] Completed successfully.");
	} catch (error) {
		const report = buildFailureReport({
			error,
			session,
			failureKind: error instanceof OperatorMarkedStepFailedError ? "operator-fail" : "runtime-error",
			operatorVerdict,
			mainStep: latestMainStep,
			subStep: latestSubStep,
			state: latestState,
		});
		const reportPath = writeFailureReport(report);
		printFailureSummary(report, reportPath);
		if (error instanceof OperatorMarkedStepFailedError) {
			throw new Error(`debug-calibrate-all stopped after operator-marked failure. Report: ${reportPath}`);
		}
		throw new Error(`debug-calibrate-all stopped after runtime failure. Report: ${reportPath}`);
	}
}

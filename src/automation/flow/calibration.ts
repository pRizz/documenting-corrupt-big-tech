import {
	ACTION_CALIBRATION_DEFINITIONS,
	APP_LAUNCH_RESULT_RX,
	APP_LAUNCH_RESULT_RY,
	BASE_COORDINATES_FILE,
	CAPTURE_FAST_STEP_GAP_SEC,
	CALIBRATION_SEARCH_BUTTON_PROMPT,
	CHROME_SEARCH_STEPS,
	INSTAGRAM_SEARCH_STEPS,
	TIKTOK_SEARCH_STEPS,
	type ActionCalibrationDefinition,
	type ActionContext,
	type ActionPointsByApp,
	type BaseCoordinatePoint,
	type BaseCoordinatesProfile,
	type Region,
	type SupportedApp,
	type WindowBounds,
	die,
	getAppFlowDefinition,
	parseActionId,
} from "../../utils";
import { absToRelWithinRegion, parseBoundsTuple, relToAbsWithRegion } from "../geometry";
import { buildCalibrationTelemetry, formatCalibrationPreview, promptAndCapturePoint, queryMouseLocation } from "../calibration-ui";
import { logAction, sleepAfterAction } from "../timing";
import {
	backupExistingCalibrationProfile,
	getExistingCalibrationProfile,
	persistCalibrationProfile,
} from "./profile-store";
import type { AutomationSession } from "./session";
import type { RuntimeAppContext } from "../types";
import { goHomeBestEffort, openAppBySearchWithFallback, runSearchEntry } from "./app-launch";
import { runFlowPostLaunchActions } from "./app-actions";
import type { AppLaunchContextHint, AppLaunchDebugHooks } from "./app-launch-debug";
export type CalibrateAllStepKind =
	| "preflight"
	| "focus-mirroring"
	| "capture-home-search-button"
	| "transition-context"
	| "capture-action-point"
	| "persist-profile";
export interface CalibrateAllStepDescriptor {
	index: number;
	total: number;
	id: string;
	kind: CalibrateAllStepKind;
	label: string;
	expected: string;
	definitionId?: string;
	app?: SupportedApp;
	action?: string;
	targetContext?: ActionContext;
}
export interface CalibrateAllStepRuntimeState {
	runtimeContext: RuntimeAppContext;
	contentRegion?: Region;
	mirrorWindow?: WindowBounds;
	currentDefinitionId?: string;
}
export interface CalibrateAllStepHooks {
	beforeStep?: (step: CalibrateAllStepDescriptor, state: CalibrateAllStepRuntimeState) => Promise<void> | void;
	afterStep?: (step: CalibrateAllStepDescriptor, state: CalibrateAllStepRuntimeState) => Promise<void> | void;
	onStepError?: (step: CalibrateAllStepDescriptor, error: unknown, state: CalibrateAllStepRuntimeState) => Promise<void> | void;
	buildLaunchDebugHooks?: (step: CalibrateAllStepDescriptor, state: CalibrateAllStepRuntimeState) => AppLaunchDebugHooks | undefined;
}
interface TransitionToCalibrationContextOptions {
	actionPoints?: ActionPointsByApp;
	launchDebugHooks?: AppLaunchDebugHooks;
}
export function listAvailableCalibrations(): readonly ActionCalibrationDefinition[] {
	return ACTION_CALIBRATION_DEFINITIONS.filter((definition) => definition.id.includes(":"));
}
export function isCalibratableAction(app: SupportedApp, action: string): boolean {
	return ACTION_CALIBRATION_DEFINITIONS.some((definition) => definition.id === `${app}:${action}`);
}
function logCalibrationCapture(label: string, sample: ReturnType<typeof queryMouseLocation>, contentRegion: Region): void {
	const telemetry = buildCalibrationTelemetry(sample, contentRegion);
	const formatted = formatCalibrationPreview(label, telemetry, contentRegion);
	console.log(formatted);
}

async function capturePointFromMouse(
	session: AutomationSession,
	label: string,
	contentRegion: Region,
	options: { tapAfterCapture?: boolean } = {},
): Promise<BaseCoordinatePoint> {
	await promptAndCapturePoint(label, contentRegion);
	const sample = queryMouseLocation();
	const [relX, relY] = absToRelWithinRegion(sample.x, sample.y, contentRegion, label);
	logCalibrationCapture(label, sample, contentRegion);
	const capturedPoint: BaseCoordinatePoint = {
		relX,
		relY,
		absX: sample.x,
		absY: sample.y,
	};
	if (options.tapAfterCapture) {
		await session.clickRel(capturedPoint.relX, capturedPoint.relY);
		await sleepAfterAction("calibration-point-tap", CAPTURE_FAST_STEP_GAP_SEC);
	}
	return capturedPoint;
}
function makeBasePointFromRel(rx: number, ry: number, region: Region): BaseCoordinatePoint {
	const [absX, absY] = relToAbsWithRegion(rx, ry, region);
	return { relX: rx, relY: ry, absX, absY };
}
function getAllCalibrationDefinitionsForAllMode(): ActionCalibrationDefinition[] {
	const candidates = ACTION_CALIBRATION_DEFINITIONS.filter((definition) => definition.skipInCalibrateAll !== true);
	const indexed = new Map<string, ActionCalibrationDefinition>(candidates.map((definition) => [definition.id, definition]));
	const resolved = new Set<string>();
	const visiting = new Set<string>();
	const ordered: ActionCalibrationDefinition[] = [];
	const visit = (definition: ActionCalibrationDefinition): void => {
		if (resolved.has(definition.id)) {
			return;
		}
		if (visiting.has(definition.id)) {
			die(`Circular calibration prerequisite detected: ${definition.id}`);
		}
		visiting.add(definition.id);
		for (const rawPrerequisite of definition.prerequisites ?? []) {
			const prerequisite = indexed.get(rawPrerequisite);
			if (prerequisite) {
				visit(prerequisite);
			}
		}
		visiting.delete(definition.id);
		resolved.add(definition.id);
		ordered.push(definition);
	};
	for (const definition of candidates) {
		visit(definition);
	}
	return ordered;
}
function buildStepAllocator(total: number): (step: Omit<CalibrateAllStepDescriptor, "index" | "total">) => CalibrateAllStepDescriptor {
	let index = 0;
	return (step) => ({
		index: ++index,
		total,
		...step,
	});
}
async function runCalibrateAllStep(
	step: CalibrateAllStepDescriptor,
	state: CalibrateAllStepRuntimeState,
	hooks: CalibrateAllStepHooks,
	action: () => Promise<void>,
): Promise<void> {
	try {
		await hooks.beforeStep?.(step, state);
		await action();
		await hooks.afterStep?.(step, state);
	} catch (error) {
		await hooks.onStepError?.(step, error, state);
		throw error;
	}
}
async function transitionToCalibrationContext(
	session: AutomationSession,
	definition: ActionCalibrationDefinition,
	runtimeContext: RuntimeAppContext,
	options: TransitionToCalibrationContextOptions = {},
): Promise<void> {
	const parsed = parseActionId(definition.id);
	const app = parsed.app;
	const flow = getAppFlowDefinition(app);
	const targetContext: ActionContext = definition.autoNavigateTo ?? "app-active";
	const contextHint: AppLaunchContextHint = runtimeContext.currentContext === "search-entry" ? "search-entry-active" : "unknown";
	if (runtimeContext.currentApp === app && runtimeContext.currentContext === targetContext) {
		return;
	}
	logAction(`transitionToCalibrationContext(${definition.id}): ${runtimeContext.currentContext ?? "none"} -> ${targetContext}`);
	switch (targetContext) {
		case "home":
			await goHomeBestEffort(session);
			break;
		case "search-entry":
			await runSearchEntry(session, app, { actionPoints: options.actionPoints, stopAfterSearchEntry: true });
			break;
		case "app-active":
			await openAppBySearchWithFallback(session, app, {
				actionPoints: options.actionPoints,
				contextHint,
				debugHooks: options.launchDebugHooks,
			});
			break;
		case "search-focused":
			await openAppBySearchWithFallback(session, app, {
				actionPoints: options.actionPoints,
				contextHint,
				debugHooks: options.launchDebugHooks,
			});
			if ((flow.postLaunchActions?.length ?? 0) > 0) {
				await runFlowPostLaunchActions(session, app, flow, options.actionPoints);
			}
			break;
		case "custom":
		default:
			if (runtimeContext.currentApp !== app) {
				await openAppBySearchWithFallback(session, app, {
					actionPoints: options.actionPoints,
					contextHint,
					debugHooks: options.launchDebugHooks,
				});
			}
	}
	runtimeContext.currentApp = app;
	runtimeContext.currentContext = targetContext;
}
export async function runCalibrateAllWorkflow(session: AutomationSession, hooks: CalibrateAllStepHooks = {}): Promise<void> {
	const existingProfile = getExistingCalibrationProfile(session);
	const orderedDefinitions = getAllCalibrationDefinitionsForAllMode();
	const mergedAppActionPoints: ActionPointsByApp = {
		...(existingProfile?.points.appActionPoints ?? {}),
	};
	const runtimeContext: RuntimeAppContext = {};
	session.state.calibrationContext = runtimeContext;
	const runtimeState: CalibrateAllStepRuntimeState = {
		runtimeContext,
	};
	const totalSteps = orderedDefinitions.length * 2 + 4;
	const nextStep = buildStepAllocator(totalSteps);
	let mirrorWindow: WindowBounds | undefined;
	let contentRegion: Region | undefined;
	let homeSearchButton: BaseCoordinatePoint | undefined;
	await runCalibrateAllStep(
		nextStep({
			id: "preflight-check",
			kind: "preflight",
			label: "Preflight checks",
			expected: "Verify required automation commands are available before calibration begins.",
		}),
		runtimeState,
		hooks,
		async () => {
			session.ensurePreflightChecks();
		},
	);

	await runCalibrateAllStep(
		nextStep({
			id: "focus-mirroring",
			kind: "focus-mirroring",
			label: "Focus iPhone Mirroring",
			expected: "Bring iPhone Mirroring frontmost and compute mirror/content bounds.",
		}),
		runtimeState,
		hooks,
		async () => {
			session.focusMirroring();
			const mirrorWindowBounds = session.getMirrorWindowBounds();
			mirrorWindow = parseBoundsTuple(mirrorWindowBounds);
			contentRegion = session.getContentRegion(mirrorWindowBounds);
			runtimeState.mirrorWindow = mirrorWindow;
			runtimeState.contentRegion = contentRegion;
			console.log("Calibrating all supported action points.");
			console.log(`Using content region: x=${contentRegion.x} y=${contentRegion.y} w=${contentRegion.width} h=${contentRegion.height}`);
			console.log(`Total actions to capture: ${orderedDefinitions.length}`);
		},
	);

	await runCalibrateAllStep(
		nextStep({
			id: "capture-home-search-button",
			kind: "capture-home-search-button",
			label: "Capture Home Search button",
			expected: "Capture and tap the iPhone Home Screen Search button point.",
		}),
		runtimeState,
		hooks,
		async () => {
			if (!contentRegion) {
				die("Missing content region during calibrate-all home search capture.");
			}
			homeSearchButton = await capturePointFromMouse(session, CALIBRATION_SEARCH_BUTTON_PROMPT, contentRegion, {
				tapAfterCapture: true,
			});
			runtimeContext.currentApp = undefined;
			runtimeContext.currentContext = "search-entry";
		},
	);

	for (const definition of orderedDefinitions) {
		const parsed = parseActionId(definition.id);
		const targetContext = definition.autoNavigateTo ?? "app-active";
		runtimeState.currentDefinitionId = definition.id;
		const transitionStep = nextStep({
			id: `transition:${definition.id}`,
			kind: "transition-context",
			label: `Transition context for ${definition.id}`,
			expected: `Auto-navigate to '${targetContext}' before capturing ${definition.id}.`,
			definitionId: definition.id,
			app: parsed.app,
			action: parsed.action,
			targetContext,
		});

		await runCalibrateAllStep(transitionStep, runtimeState, hooks, async () => {
			await transitionToCalibrationContext(session, definition, runtimeContext, {
				actionPoints: mergedAppActionPoints,
				launchDebugHooks: hooks.buildLaunchDebugHooks?.(transitionStep, runtimeState),
			});
		});

		await runCalibrateAllStep(
			nextStep({
				id: `capture:${definition.id}`,
				kind: "capture-action-point",
				label: `Capture ${definition.id}`,
				expected: `Capture and tap the point for ${definition.label} (${definition.id}).`,
				definitionId: definition.id,
				app: parsed.app,
				action: parsed.action,
				targetContext,
			}),
			runtimeState,
			hooks,
			async () => {
				if (!contentRegion) {
					die(`Missing content region during capture for ${definition.id}.`);
				}
				const capturedPoint = await capturePointFromMouse(session, `${definition.label} (${definition.id})`, contentRegion, {
					tapAfterCapture: true,
				});
				const currentForApp = mergedAppActionPoints[parsed.app] ?? {};
				currentForApp[parsed.action] = capturedPoint;
				mergedAppActionPoints[parsed.app] = currentForApp;
			},
		);
	}

	await runCalibrateAllStep(
		nextStep({
			id: "persist-profile",
			kind: "persist-profile",
			label: "Persist calibration profile",
			expected: "Write updated calibration profile, screenshot, and backup snapshot.",
		}),
		runtimeState,
		hooks,
		async () => {
			if (!mirrorWindow || !contentRegion || !homeSearchButton) {
				die("Missing required calibrate-all state before profile persistence.");
			}

			const baseCoordinatesProfile: BaseCoordinatesProfile = {
				version: 1,
				generatedAt: new Date().toISOString(),
				mirrorWindow,
				contentRegion,
				points: {
					homeSearchButton,
					launchResultTap: makeBasePointFromRel(APP_LAUNCH_RESULT_RX, APP_LAUNCH_RESULT_RY, contentRegion),
					appSearchSteps: {
						chrome: existingProfile?.points.appSearchSteps?.chrome ?? CHROME_SEARCH_STEPS,
						instagram: existingProfile?.points.appSearchSteps?.instagram ?? INSTAGRAM_SEARCH_STEPS,
						tiktok: existingProfile?.points.appSearchSteps?.tiktok ?? TIKTOK_SEARCH_STEPS,
					},
					appActionPoints: mergedAppActionPoints,
				},
			};

			const backupPath = backupExistingCalibrationProfile(session);
			session.screenshotContent("./calibration/iphone_content.png");
			persistCalibrationProfile(session, baseCoordinatesProfile);
			console.log("Wrote ./calibration/iphone_content.png");
			console.log("Wrote ./calibration/base-coordinates.json");
			if (backupPath) {
				console.log(`Backed up previous calibration to: ${backupPath}`);
			}
			console.log(`Configured ${orderedDefinitions.length + 1} calibration points in ${BASE_COORDINATES_FILE}.`);
		},
	);
}

export async function calibrateAll(session: AutomationSession): Promise<void> {
	return runCalibrateAllWorkflow(session);
}

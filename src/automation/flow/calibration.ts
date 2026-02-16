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
	die,
	getActionDefinition,
	getAppFlowDefinition,
	parseActionId,
} from "../../utils";
import { absToRelWithinRegion, parseBoundsTuple, relToAbsWithRegion } from "../geometry";
import { buildCalibrationTelemetry, formatCalibrationPreview, promptAndCapturePoint, queryMouseLocation } from "../calibration-ui";
import { logAction, sleepAfterAction } from "../timing";
import {
	backupExistingCalibrationProfile,
	getCalibrationProfile,
	getExistingCalibrationProfile,
	persistCalibrationProfile,
	updateActionPointInProfile,
} from "./profile-store";
import type { AutomationSession } from "./session";
import type { RuntimeAppContext } from "../types";
import { getActionPoint, goHomeBestEffort, openAppBySearchWithFallback, runFlowPostLaunchActions, runSearchEntry } from "./app-launch";

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

function resolveActionPointFromActionId(
	session: AutomationSession,
	actionId: string,
	appActionPoints?: ActionPointsByApp,
): { app: SupportedApp; action: string; point?: BaseCoordinatePoint } {
	const parsed = parseActionId(actionId);
	const point = getActionPoint(session, parsed.app, parsed.action, appActionPoints);
	return { app: parsed.app, action: parsed.action, point };
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

async function transitionToCalibrationContext(
	session: AutomationSession,
	definition: ActionCalibrationDefinition,
	runtimeContext: RuntimeAppContext,
	actionPoints?: ActionPointsByApp,
): Promise<void> {
	const parsed = parseActionId(definition.id);
	const app = parsed.app;
	const flow = getAppFlowDefinition(app);
	const targetContext: ActionContext = definition.autoNavigateTo ?? "app-active";

	if (runtimeContext.currentApp === app && runtimeContext.currentContext === targetContext) {
		return;
	}

	logAction(`transitionToCalibrationContext(${definition.id}): ${runtimeContext.currentContext ?? "none"} -> ${targetContext}`);
	switch (targetContext) {
		case "home":
			await goHomeBestEffort(session);
			break;
		case "search-entry":
			await runSearchEntry(session, app, { actionPoints, stopAfterSearchEntry: true });
			break;
		case "app-active":
			await openAppBySearchWithFallback(session, app, actionPoints);
			break;
		case "search-focused":
			await openAppBySearchWithFallback(session, app, actionPoints);
			if ((flow.postLaunchActions?.length ?? 0) > 0) {
				await runFlowPostLaunchActions(session, app, flow, actionPoints);
			}
			break;
		case "custom":
		default:
			if (runtimeContext.currentApp !== app) {
				await openAppBySearchWithFallback(session, app, actionPoints);
			}
	}

	runtimeContext.currentApp = app;
	runtimeContext.currentContext = targetContext;
}

export async function calibrateMode(session: AutomationSession): Promise<void> {
	session.ensurePreflightChecks();
	session.focusMirroring();
	const mirrorWindowBounds = session.getMirrorWindowBounds();
	const mirrorWindow = parseBoundsTuple(mirrorWindowBounds);
	const contentRegion = session.getContentRegion(mirrorWindowBounds);
	const existingProfile = getExistingCalibrationProfile(session);
	const existingAppActionPoints = existingProfile?.points.appActionPoints;

	console.log(`Using content region: x=${contentRegion.x} y=${contentRegion.y} w=${contentRegion.width} h=${contentRegion.height}`);
	const homeSearchButton = await capturePointFromMouse(session, CALIBRATION_SEARCH_BUTTON_PROMPT, contentRegion);

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
			appActionPoints: existingAppActionPoints,
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
}

export async function calibrateAll(session: AutomationSession): Promise<void> {
	session.ensurePreflightChecks();
	session.focusMirroring();
	const mirrorWindowBounds = session.getMirrorWindowBounds();
	const mirrorWindow = parseBoundsTuple(mirrorWindowBounds);
	const contentRegion = session.getContentRegion(mirrorWindowBounds);
	const existingProfile = getExistingCalibrationProfile(session);
	const orderedDefinitions = getAllCalibrationDefinitionsForAllMode();
	const mergedAppActionPoints: ActionPointsByApp = {
		...(existingProfile?.points.appActionPoints ?? {}),
	};
	const runtimeContext: RuntimeAppContext = {};

	console.log("Calibrating all supported action points.");
	console.log(`Using content region: x=${contentRegion.x} y=${contentRegion.y} w=${contentRegion.width} h=${contentRegion.height}`);
	console.log(`Total actions to capture: ${orderedDefinitions.length}`);

	const homeSearchButton = await capturePointFromMouse(session, CALIBRATION_SEARCH_BUTTON_PROMPT, contentRegion, {
		tapAfterCapture: true,
	});

	for (const definition of orderedDefinitions) {
		await transitionToCalibrationContext(session, definition, runtimeContext, mergedAppActionPoints);
		const { app, action } = resolveActionPointFromActionId(session, definition.id);
		const capturedPoint = await capturePointFromMouse(session, `${definition.label} (${definition.id})`, contentRegion, {
			tapAfterCapture: true,
		});
		const currentForApp = mergedAppActionPoints[app] ?? {};
		currentForApp[action] = capturedPoint;
		mergedAppActionPoints[app] = currentForApp;
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
}

export async function calibrateAction(session: AutomationSession, app: SupportedApp, action: string): Promise<void> {
	session.ensurePreflightChecks();
	const definition = getActionDefinition(app, action);
	if (!definition) {
		die(`Unsupported calibration action '${app}:${action}'.`);
	}

	const profile = getCalibrationProfile(session);
	session.focusMirroring();
	const mirrorWindowBounds = session.getMirrorWindowBounds();
	const contentRegion = session.getContentRegion(mirrorWindowBounds);
	console.log(`Calibrating action point '${definition.label}' (${definition.id}).`);
	console.log("Move your mouse over the target point and press Enter to capture it.");

	const capturedPoint = await capturePointFromMouse(session, `${definition.label} (${definition.id})`, contentRegion);
	const backupPath = backupExistingCalibrationProfile(session);
	const updatedProfile = updateActionPointInProfile(profile, app, action, capturedPoint);
	persistCalibrationProfile(session, updatedProfile);

	console.log(`Updated ${BASE_COORDINATES_FILE} with ${definition.id}.`);
	console.log(`  rel=${capturedPoint.relX.toFixed(6)},${capturedPoint.relY.toFixed(6)}`);
	if (capturedPoint.absX !== undefined && capturedPoint.absY !== undefined) {
		console.log(`  abs=${capturedPoint.absX},${capturedPoint.absY}`);
	}
	if (backupPath) {
		console.log(`Backed up previous calibration to: ${backupPath}`);
	}
}

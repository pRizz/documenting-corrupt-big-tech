import {
	APP_LAUNCH_QUERY,
	CAPTURE_FAST_STEP_GAP_SEC,
	CAPTURE_USE_MIRROR_SHORTCUTS,
	CHROME_ICON_RX,
	CHROME_ICON_RY,
	INSTAGRAM_ICON_RX,
	INSTAGRAM_ICON_RY,
	MIRROR_HOME_SHORTCUT_KEY,
	MIRROR_SEARCH_SHORTCUT_KEY,
	TIKTOK_ICON_RX,
	TIKTOK_ICON_RY,
	type ActionPointsByApp,
	type AppFlowDefinition,
	type SupportedApp,
	die,
	getActionDefinition,
	getAppFlowDefinition,
	logStep,
	parseActionId,
} from "../../utils";
import { logAction, sleepAfterAction } from "../timing";
import { getCalibrationProfile } from "./profile-store";
import type { AutomationSession } from "./session";

interface RunSearchEntryOptions {
	actionPoints?: ActionPointsByApp;
	stopAfterSearchEntry?: boolean;
}

function getFlowSearchSteps(session: AutomationSession, app: SupportedApp, flow: AppFlowDefinition): string {
	if (flow.searchActions?.fallbackSearchSteps) {
		return flow.searchActions.fallbackSearchSteps;
	}
	const profile = getCalibrationProfile(session);
	const steps = profile.points.appSearchSteps[app];
	if (!steps) {
		die(`No search steps in calibration for app '${app}'.`);
	}
	return steps;
}

export function getActionPoint(
	session: AutomationSession,
	app: SupportedApp,
	action: string,
	appActionPoints?: ActionPointsByApp,
) {
	const actionPoints = appActionPoints ?? getCalibrationProfile(session).points.appActionPoints;
	if (!actionPoints) {
		return undefined;
	}
	const appActionPointsMap = actionPoints[app];
	if (!appActionPointsMap) {
		return undefined;
	}
	return appActionPointsMap[action];
}

export function getSearchButtonProfilePoint(session: AutomationSession) {
	return getCalibrationProfile(session).points.homeSearchButton;
}

function getLaunchResultProfilePoint(session: AutomationSession) {
	return getCalibrationProfile(session).points.launchResultTap;
}

export function isActionRequiredForCapture(app: SupportedApp, action: string, flow: AppFlowDefinition): boolean {
	const definition = getActionDefinition(app, action);
	if (!definition) {
		return false;
	}
	if (definition.requiredForCapture) {
		return true;
	}
	return (flow.requiredCalibrationForCapture ?? []).includes(`${app}:${action}`);
}

async function captureActionPoint(
	session: AutomationSession,
	app: SupportedApp,
	action: string,
	flow: AppFlowDefinition,
	actionPoints?: ActionPointsByApp,
	options: { required?: boolean; label?: string } = {},
): Promise<boolean> {
	const definition = getActionDefinition(app, action);
	const point = getActionPoint(session, app, action, actionPoints);
	const actionId = `${app}:${action}`;

	if (point) {
		logAction(`${options.label ?? `action ${actionId}`}: using calibrated point`);
		await session.clickRel(point.relX, point.relY);
		await sleepAfterAction(`capture-point:${actionId}`, CAPTURE_FAST_STEP_GAP_SEC);
		return true;
	}

	if (definition?.fallbackTapSteps) {
		logAction(`${options.label ?? `action ${actionId}`}: using fallback tap steps`);
		await session.tapSequence(definition.fallbackTapSteps);
		await sleepAfterAction(`capture-point:${actionId}:fallback`, CAPTURE_FAST_STEP_GAP_SEC);
		return false;
	}

	if (options.required !== false && isActionRequiredForCapture(app, action, flow)) {
		die(`Missing required action point: ${actionId}\nCalibrate with: bun run capture -- --calibrate-action ${actionId}`);
	}

	logAction(`capturePoint(${actionId}): missing optional point`);
	return false;
}

export async function runFlowPostLaunchActions(
	session: AutomationSession,
	app: SupportedApp,
	flow: AppFlowDefinition,
	actionPoints?: ActionPointsByApp,
): Promise<void> {
	for (const actionId of flow.postLaunchActions ?? []) {
		const parsed = parseActionId(actionId);
		if (parsed.app !== app) {
			continue;
		}
		await captureActionPoint(session, app, parsed.action, flow, actionPoints, {
			required: isActionRequiredForCapture(app, parsed.action, flow),
			label: `post-launch ${actionId}`,
		});
	}
}

export async function runAppSearchPlacement(
	session: AutomationSession,
	app: SupportedApp,
	flow: AppFlowDefinition,
	actionPoints?: ActionPointsByApp,
): Promise<void> {
	const inAppSearchPoint = flow.searchActions?.inAppSearchPoint;
	if (inAppSearchPoint) {
		const used = await captureActionPoint(session, app, inAppSearchPoint, flow, actionPoints, {
			required: isActionRequiredForCapture(app, inAppSearchPoint, flow),
			label: `${app}:search placement (${inAppSearchPoint})`,
		});
		if (used) {
			return;
		}
	}

	const fallback = getFlowSearchSteps(session, app, flow);
	logAction(`runAppSearchPlacement(${app}): using fallback search steps`);
	await session.tapSequence(fallback);
}

export async function goHomeBestEffort(session: AutomationSession): Promise<void> {
	if (CAPTURE_USE_MIRROR_SHORTCUTS) {
		logAction("Issuing Command+1 (Mirroring Home)");
		if (await session.sendHostKeystroke(MIRROR_HOME_SHORTCUT_KEY, "command", "go-home-key-shortcut")) {
			logAction("Command+1 sent");
			await sleepAfterAction("home-command", CAPTURE_FAST_STEP_GAP_SEC);
			return;
		}
		logAction("Command+1 failed; falling back to Command+H and swipe");
	} else {
		logAction("Skipping mirroring shortcut navigation because CAPTURE_USE_MIRROR_SHORTCUTS=0");
	}

	logAction("Issuing Command+H");
	if (await session.sendHostKeystroke("h", "command", "go-home-key")) {
		logAction("Command+H sent");
		await sleepAfterAction("home-command-legacy", CAPTURE_FAST_STEP_GAP_SEC);
	} else {
		logAction("Command+H failed; using swipe fallback");
	}
	await sleepAfterAction("home-swipe-prep", CAPTURE_FAST_STEP_GAP_SEC);
	await session.dragRel(0.5, 0.96, 0.5, 0.55);
	await sleepAfterAction("home-swipe-fallback", CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("home-swipe-finish", CAPTURE_FAST_STEP_GAP_SEC);
}

export async function openAppFromHome(session: AutomationSession, app: SupportedApp): Promise<void> {
	const fallbackIconPoint = getActionPoint(session, app, "homeIcon");
	const iconMap: Record<SupportedApp, [number, number]> = {
		chrome: [CHROME_ICON_RX, CHROME_ICON_RY],
		instagram: [INSTAGRAM_ICON_RX, INSTAGRAM_ICON_RY],
		tiktok: [TIKTOK_ICON_RX, TIKTOK_ICON_RY],
	};

	if (!(await session.ensureMirrorFrontmost("open-app-from-home"))) {
		die("Could not ensure mirror host before opening app.");
	}
	await goHomeBestEffort(session);
	if (!(await session.ensureMirrorFrontmost("open-app:before-icon-tap"))) {
		die("Could not ensure mirror host before app icon tap.");
	}
	if (fallbackIconPoint) {
		logAction(`openAppFromHome(${app}): using calibrated homeIcon`);
		await session.clickRel(fallbackIconPoint.relX, fallbackIconPoint.relY);
	} else {
		const fallback = iconMap[app];
		logAction(`openAppFromHome(${app}): using fallback hard-coded icon coordinates`);
		await session.clickRel(fallback[0], fallback[1]);
	}
	await sleepAfterAction("open-app-from-home-legacy", CAPTURE_FAST_STEP_GAP_SEC);
}

export async function runSearchEntry(
	session: AutomationSession,
	app: SupportedApp,
	options: RunSearchEntryOptions = {},
): Promise<void> {
	const appName = APP_LAUNCH_QUERY[app];
	const flow = getAppFlowDefinition(app);
	const searchIconPoint = getActionPoint(session, app, "searchIcon", options.actionPoints);
	const searchPoint = searchIconPoint ?? getSearchButtonProfilePoint(session);

	logAction(`Opening ${app} via Search flow`);
	logAction(`runSearchEntry(${app}): checking initial frontmost`);
	if (!(await session.ensureMirrorFrontmost("open-app-by-search:initial-focus"))) {
		die("Could not ensure mirror host before search launch.");
	}
	logAction(`runSearchEntry(${app}): initial frontmost ok`);
	await sleepAfterAction("before-go-home", CAPTURE_FAST_STEP_GAP_SEC);

	if (flow.launch === "legacyHomeIconOnly") {
		await openAppFromHome(session, app);
		return;
	}

	logAction(`runSearchEntry(${app}): entering goHomeBestEffort`);
	await goHomeBestEffort(session);
	logAction(`runSearchEntry(${app}): goHomeBestEffort complete`);
	await sleepAfterAction("post-go-home", CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("before-search-tap", CAPTURE_FAST_STEP_GAP_SEC);

	let usedSearchShortcut = false;
	if (CAPTURE_USE_MIRROR_SHORTCUTS && flow.launch !== "searchIcon") {
		logAction("Issuing Command+3 (Mirroring Search)");
		if (await session.sendHostKeystroke(MIRROR_SEARCH_SHORTCUT_KEY, "command", `run-search-entry:${app}-search-shortcut`)) {
			logAction("Command+3 sent");
			usedSearchShortcut = true;
		} else {
			logAction("Command+3 failed, using Search icon tap fallback");
		}
	} else if (!CAPTURE_USE_MIRROR_SHORTCUTS) {
		logAction("Skipping Mirroring Search shortcut because CAPTURE_USE_MIRROR_SHORTCUTS=0");
	} else if (flow.launch === "searchIcon") {
		logAction("runSearchEntry configured for search icon flow (shortcut suppressed by launch mode).");
	}

	if (!usedSearchShortcut) {
		if (!(await session.ensureMirrorFrontmost("run-search-entry:search-button"))) {
			die("Could not ensure mirror host before tapping Search.");
		}
		logAction(`runSearchEntry(${app}): search-button frontmost ok`);
		logAction("Tapping Search icon");
		if (searchIconPoint) {
			logAction(`runSearchEntry(${app}): using calibrated searchIcon action point`);
		} else {
			logAction(`runSearchEntry(${app}): using fallback home search point`);
		}
		await session.clickRel(searchPoint.relX, searchPoint.relY);
		logAction(`runSearchEntry(${app}): search icon tapped`);
		await sleepAfterAction("search-icon-tap", CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("search-icon-to-clear", CAPTURE_FAST_STEP_GAP_SEC);
	} else {
		await sleepAfterAction("search-shortcut", CAPTURE_FAST_STEP_GAP_SEC);
	}

	if (flow.launch === "searchIcon" || options.stopAfterSearchEntry) {
		return;
	}

	logAction(`runSearchEntry(${app}): clearing Search field`);
	await session.clearField();
	await sleepAfterAction("search-clear", CAPTURE_FAST_STEP_GAP_SEC);
	logAction(`Typing app name '${appName}'`);
	await session.typeText(appName, CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("search-typing", CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("typing-to-launch", CAPTURE_FAST_STEP_GAP_SEC);
}

export async function openAppBySearch(session: AutomationSession, app: SupportedApp, actionPoints?: ActionPointsByApp): Promise<void> {
	const flow = getAppFlowDefinition(app);
	logAction(`openAppBySearch(${app}): begin`);
	await runSearchEntry(session, app, { actionPoints });
	logAction(`openAppBySearch(${app}): entry ready`);
	if (flow.launch === "searchIcon") {
		await session.ensureMirrorFrontmost("open-app-by-search:home-search");
		logStep(`openAppBySearch(${app}): search icon launch mode does not support app query submission`);
		return;
	}

	switch (flow.searchSubmitMode) {
		case "enter":
			logAction("Submitting search with Enter");
			if (!(await session.sendHostKeystroke("return", "", `open-app-by-search:${app}-submit`))) {
				die(`Could not submit search for ${app}.`);
			}
			break;
		case "tapResult": {
			logAction(`Submitting search for ${app} with launch-result tap`);
			const launchTap = getLaunchResultProfilePoint(session);
			await session.clickRel(launchTap.relX, launchTap.relY);
			await sleepAfterAction("search-submit", CAPTURE_FAST_STEP_GAP_SEC);
			break;
		}
		default:
			die(`Unsupported search submit mode for app '${app}'.`);
	}
	await sleepAfterAction("search-submit", CAPTURE_FAST_STEP_GAP_SEC);
	logAction(`openAppBySearch(${app}): complete`);
}

export async function openAppBySearchWithFallback(session: AutomationSession, app: SupportedApp, actionPoints?: ActionPointsByApp): Promise<void> {
	logAction(`Starting app launch for ${app}`);
	try {
		logAction(`openAppBySearchWithFallback(${app}): trying search flow`);
		await openAppBySearch(session, app, actionPoints);
		logAction(`openAppBySearchWithFallback(${app}): search flow succeeded`);
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logAction(`Search flow failed for ${app}: ${message}`);
		logAction("Falling back to home icon launch");
	}

	await sleepAfterAction("search-fallback-switch", CAPTURE_FAST_STEP_GAP_SEC);
	await openAppFromHome(session, app);
}

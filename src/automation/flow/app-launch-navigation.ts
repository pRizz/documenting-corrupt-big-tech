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
	type SupportedApp,
	die,
	getAppFlowDefinition,
	logStep,
} from "../../utils";
import { logAction, sleepAfterAction } from "../timing";
import type { AutomationSession } from "./session";
import { getCalibrationProfile } from "./profile-store";

export interface RunSearchEntryOptions {
	actionPoints?: ActionPointsByApp;
	stopAfterSearchEntry?: boolean;
	preferMirrorShortcuts?: boolean;
	attemptLabel?: string;
}

export interface SearchEntryResult {
	usedSearchShortcut: boolean;
}

export function getActionPoint(session: AutomationSession, app: SupportedApp, action: string, appActionPoints?: ActionPointsByApp) {
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

export function getLaunchResultProfilePoint(session: AutomationSession) {
	return getCalibrationProfile(session).points.launchResultTap;
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

export async function runSearchEntry(session: AutomationSession, app: SupportedApp, options: RunSearchEntryOptions = {}): Promise<SearchEntryResult> {
	const flow = getAppFlowDefinition(app);
	const searchIconPoint = getActionPoint(session, app, "searchIcon", options.actionPoints);
	const searchPoint = searchIconPoint ?? getSearchButtonProfilePoint(session);
	const preferMirrorShortcuts = options.preferMirrorShortcuts ?? CAPTURE_USE_MIRROR_SHORTCUTS;
	const label = options.attemptLabel ? ` [${options.attemptLabel}]` : "";
	logAction(`Opening ${app} via Search flow${label}`);
	logAction(`runSearchEntry(${app})${label}: checking initial frontmost`);
	if (!(await session.ensureMirrorFrontmost("open-app-by-search:initial-focus"))) {
		die("Could not ensure mirror host before search launch.");
	}
	logAction(`runSearchEntry(${app})${label}: initial frontmost ok`);
	await sleepAfterAction("before-go-home", CAPTURE_FAST_STEP_GAP_SEC);
	if (flow.launch === "legacyHomeIconOnly") {
		await openAppFromHome(session, app);
		return { usedSearchShortcut: false };
	}
	logAction(`runSearchEntry(${app})${label}: entering goHomeBestEffort`);
	await goHomeBestEffort(session);
	logAction(`runSearchEntry(${app})${label}: goHomeBestEffort complete`);
	await sleepAfterAction("post-go-home", CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("before-search-tap", CAPTURE_FAST_STEP_GAP_SEC);
	let usedSearchShortcut = false;
	if (preferMirrorShortcuts && flow.launch !== "searchIcon") {
		logAction(`Issuing Command+3 (Mirroring Search)${label}`);
		if (await session.sendHostKeystroke(MIRROR_SEARCH_SHORTCUT_KEY, "command", `run-search-entry:${app}-search-shortcut`)) {
			logAction(`Command+3 sent${label}`);
			usedSearchShortcut = true;
		} else {
			logAction(`Command+3 failed, using Search icon tap fallback${label}`);
		}
	} else if (!preferMirrorShortcuts) {
		logAction(`Skipping Mirroring Search shortcut for deterministic tap-only launch${label}`);
	} else if (flow.launch === "searchIcon") {
		logAction(`runSearchEntry configured for search icon flow (shortcut suppressed by launch mode)${label}.`);
	}
	if (!usedSearchShortcut) {
		if (!(await session.ensureMirrorFrontmost("run-search-entry:search-button"))) {
			die("Could not ensure mirror host before tapping Search.");
		}
		logAction(`runSearchEntry(${app})${label}: search-button frontmost ok`);
		logAction(`Tapping Search icon${label}`);
		if (searchIconPoint) {
			logAction(`runSearchEntry(${app})${label}: using calibrated searchIcon action point`);
		} else {
			logAction(`runSearchEntry(${app})${label}: using fallback home search point`);
		}
		await session.clickRel(searchPoint.relX, searchPoint.relY);
		logAction(`runSearchEntry(${app})${label}: search icon tapped`);
		await sleepAfterAction("search-icon-tap", CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("search-icon-to-clear", CAPTURE_FAST_STEP_GAP_SEC);
	} else {
		await sleepAfterAction("search-shortcut", CAPTURE_FAST_STEP_GAP_SEC);
	}
	if (flow.launch === "searchIcon" || options.stopAfterSearchEntry) {
		return { usedSearchShortcut };
	}
	const appName = APP_LAUNCH_QUERY[app];
	logAction(`runSearchEntry(${app})${label}: clearing Search field`);
	await session.clearField();
	await sleepAfterAction("search-clear", CAPTURE_FAST_STEP_GAP_SEC);
	logAction(`Typing app name '${appName}'${label}`);
	await session.typeText(appName, CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("search-typing", CAPTURE_FAST_STEP_GAP_SEC);
	await sleepAfterAction("typing-to-launch", CAPTURE_FAST_STEP_GAP_SEC);
	return { usedSearchShortcut };
}

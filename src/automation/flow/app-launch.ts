import {
	APP_LAUNCH_QUERY,
	CAPTURE_FAST_STEP_GAP_SEC,
	CAPTURE_USE_MIRROR_SHORTCUTS,
	type ActionPointsByApp,
	type AppFlowDefinition,
	type SupportedApp,
	die,
	getAppFlowDefinition,
	logStep,
} from "../../utils";
import { logAction, sleepAfterAction } from "../timing";
import type { AutomationSession } from "./session";
import {
	type AppLaunchContextHint,
	type AppLaunchDebugHooks,
} from "./app-launch-debug";
import { runLaunchStepWithFocus as runLaunchDebugStep } from "./app-launch-step-runner";
import {
	getLaunchResultProfilePoint,
	runSearchEntry,
	openAppFromHome,
	type SearchEntryResult,
} from "./app-launch-navigation";

export {
	getActionPoint,
	getSearchButtonProfilePoint,
	goHomeBestEffort,
	openAppFromHome,
	runSearchEntry,
} from "./app-launch-navigation";

interface LaunchAttempt {
	number: number;
	mode: "shortcut-preferred" | "tap-only";
	preferMirrorShortcuts: boolean;
	reason: string;
}

export interface OpenAppBySearchWithFallbackOptions {
	actionPoints?: ActionPointsByApp;
	contextHint?: AppLaunchContextHint;
	debugHooks?: AppLaunchDebugHooks;
}

interface OpenAppBySearchAttemptOptions {
	actionPoints?: ActionPointsByApp;
	contextHint: AppLaunchContextHint;
	debugHooks?: AppLaunchDebugHooks;
}

function attemptLabel(attempt: LaunchAttempt): string {
	return `attempt ${attempt.number} (${attempt.mode})`;
}

function buildLaunchAttempts(): LaunchAttempt[] {
	const firstAttempt: LaunchAttempt = CAPTURE_USE_MIRROR_SHORTCUTS
		? {
				number: 1,
				mode: "shortcut-preferred",
				preferMirrorShortcuts: true,
				reason: "CAPTURE_USE_MIRROR_SHORTCUTS=1",
			}
		: {
				number: 1,
				mode: "tap-only",
				preferMirrorShortcuts: false,
				reason: "CAPTURE_USE_MIRROR_SHORTCUTS=0",
			};
	const attempts: LaunchAttempt[] = [firstAttempt];
	if (firstAttempt.preferMirrorShortcuts) {
		attempts.push({
			number: 2,
			mode: "tap-only",
			preferMirrorShortcuts: false,
			reason: "deterministic autonomous retry",
		});
	}
	return attempts;
}

function shouldForceDeterministicRetry(flow: AppFlowDefinition, attempt: LaunchAttempt, entryResult: SearchEntryResult): boolean {
	if (!attempt.preferMirrorShortcuts || !entryResult.usedSearchShortcut || flow.launch === "searchIcon") {
		return false;
	}
	return flow.searchSubmitMode === "enter";
}

function shouldAbortRetries(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.name === "OperatorMarkedStepFailedError" || error.message.includes("canceled by user");
}

async function submitSearchLaunch(
	session: AutomationSession,
	app: SupportedApp,
	flow: AppFlowDefinition,
	attemptMode: string,
): Promise<void> {
	switch (flow.searchSubmitMode) {
		case "enter":
			logAction(`Submitting search with Enter (${attemptMode})`);
			if (!(await session.sendHostKeystroke("return", "", `open-app-by-search:${app}-submit`))) {
				die(`Could not submit search for ${app}.`);
			}
			break;
		case "tapResult": {
			logAction(`Submitting search for ${app} with launch-result tap (${attemptMode})`);
			const launchTap = getLaunchResultProfilePoint(session);
			await session.clickRel(launchTap.relX, launchTap.relY);
			await sleepAfterAction("search-submit", CAPTURE_FAST_STEP_GAP_SEC);
			break;
		}
		default:
			die(`Unsupported search submit mode for app '${app}'.`);
	}
	await sleepAfterAction("search-submit", CAPTURE_FAST_STEP_GAP_SEC);
}

async function openAppBySearch(
	session: AutomationSession,
	app: SupportedApp,
	attempt: LaunchAttempt,
	options: OpenAppBySearchAttemptOptions,
): Promise<SearchEntryResult> {
	const flow = getAppFlowDefinition(app);
	const label = attemptLabel(attempt);
	const attemptMode = attempt.mode;
	logAction(`openAppBySearch(${app}): begin ${label}`);
	let entryResult: SearchEntryResult = { usedSearchShortcut: false };

	await runLaunchDebugStep(session, options.debugHooks, app, options.contextHint, {
		id: `acquire-search-entry:${app}:attempt-${attempt.number}`,
		kind: "acquire-search-entry",
		label: `Acquire Search entry for ${app} (${label})`,
		expected: "Navigate to Home Search and focus the Search field for launch.",
		attemptNumber: attempt.number,
		attemptMode,
	}, async () => {
		entryResult = await runSearchEntry(session, app, {
			actionPoints: options.actionPoints,
			preferMirrorShortcuts: attempt.preferMirrorShortcuts,
			attemptLabel: label,
			stopAfterSearchEntry: true,
		});
	});

	if (flow.launch === "searchIcon") {
		await session.ensureMirrorFrontmost("open-app-by-search:home-search");
		logStep(`openAppBySearch(${app}): search icon launch mode does not support app query submission (${label})`);
		return entryResult;
	}

	const appName = APP_LAUNCH_QUERY[app];
	await runLaunchDebugStep(session, options.debugHooks, app, options.contextHint, {
		id: `clear-field:${app}:attempt-${attempt.number}`,
		kind: "clear-field",
		label: `Clear Search field for ${app} (${label})`,
		expected: "Clear existing Search text before typing app name.",
		attemptNumber: attempt.number,
		attemptMode,
	}, async () => {
		await session.clearField();
		await sleepAfterAction("search-clear", CAPTURE_FAST_STEP_GAP_SEC);
	});

	await runLaunchDebugStep(session, options.debugHooks, app, options.contextHint, {
		id: `type-query:${app}:attempt-${attempt.number}`,
		kind: "type-query",
		label: `Type '${appName}' (${label})`,
		expected: `Type '${appName}' into Search.`,
		attemptNumber: attempt.number,
		attemptMode,
	}, async () => {
		await session.typeText(appName, CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("search-typing", CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("typing-to-launch", CAPTURE_FAST_STEP_GAP_SEC);
	});

	await runLaunchDebugStep(session, options.debugHooks, app, options.contextHint, {
		id: `submit-launch:${app}:attempt-${attempt.number}`,
		kind: "submit-launch",
		label: `Submit app launch for ${app} (${label})`,
		expected: "Submit Search result to open the target app.",
		attemptNumber: attempt.number,
		attemptMode,
	}, async () => {
		await submitSearchLaunch(session, app, flow, label);
	});

	logAction(`openAppBySearch(${app}): complete ${label}`);
	return entryResult;
}

async function launchFromActiveSearchContext(
	session: AutomationSession,
	app: SupportedApp,
	contextHint: AppLaunchContextHint,
	debugHooks: AppLaunchDebugHooks | undefined,
): Promise<void> {
	const flow = getAppFlowDefinition(app);
	const appName = APP_LAUNCH_QUERY[app];
	const attemptMode = "active-search";

	await runLaunchDebugStep(session, debugHooks, app, contextHint, {
		id: `clear-field:${app}:active-search`,
		kind: "clear-field",
		label: `Clear Search field for ${app} (active context)`,
		expected: "Clear active Search field before typing app name.",
		attemptMode,
	}, async () => {
		await session.clearField();
		await sleepAfterAction("search-clear", CAPTURE_FAST_STEP_GAP_SEC);
	});

	await runLaunchDebugStep(session, debugHooks, app, contextHint, {
		id: `type-query:${app}:active-search`,
		kind: "type-query",
		label: `Type '${appName}' (active context)`,
		expected: `Type '${appName}' into active Search field.`,
		attemptMode,
	}, async () => {
		await session.typeText(appName, CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("search-typing", CAPTURE_FAST_STEP_GAP_SEC);
		await sleepAfterAction("typing-to-launch", CAPTURE_FAST_STEP_GAP_SEC);
	});

	if (flow.launch === "searchIcon") {
		logStep(`launchFromActiveSearchContext(${app}): search icon launch mode has no app query submit.`);
		return;
	}

	await runLaunchDebugStep(session, debugHooks, app, contextHint, {
		id: `submit-launch:${app}:active-search`,
		kind: "submit-launch",
		label: `Submit app launch for ${app} (active context)`,
		expected: "Submit Search result to open the target app.",
		attemptMode,
	}, async () => {
		await submitSearchLaunch(session, app, flow, attemptMode);
	});
}

export async function openAppBySearchWithFallback(
	session: AutomationSession,
	app: SupportedApp,
	options: OpenAppBySearchWithFallbackOptions = {},
): Promise<void> {
	const flow = getAppFlowDefinition(app);
	const attempts = buildLaunchAttempts();
	const contextHint = options.contextHint ?? "unknown";
	const actionPoints = options.actionPoints;
	const debugHooks = options.debugHooks;
	let lastError: unknown;
	logAction(`Starting app launch for ${app}`);

	if (contextHint === "search-entry-active") {
		try {
			logAction(`openAppBySearchWithFallback(${app}): trying active search-entry context launch first`);
			await launchFromActiveSearchContext(session, app, contextHint, debugHooks);
			logAction(`openAppBySearchWithFallback(${app}): launch succeeded from active search context`);
			return;
		} catch (error) {
			if (shouldAbortRetries(error)) {
				throw error;
			}
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			logAction(`openAppBySearchWithFallback(${app}): active search-entry launch failed: ${message}`);
			await runLaunchDebugStep(session, debugHooks, app, contextHint, {
				id: `retry-switch:${app}:active-search-to-standard`,
				kind: "retry-switch",
				label: `Retry launch for ${app} using standard search flow`,
				expected: "Switch from active-search launch to full search-entry acquisition flow.",
				attemptMode: "active-search",
			}, async () => {
				await sleepAfterAction("search-launch-retry-switch", CAPTURE_FAST_STEP_GAP_SEC);
			});
		}
	}

	for (const attempt of attempts) {
		const label = attemptLabel(attempt);
		logAction(`openAppBySearchWithFallback(${app}): ${label} using ${attempt.reason}`);
		try {
			const entryResult = await openAppBySearch(session, app, attempt, {
				actionPoints,
				contextHint,
				debugHooks,
			});
				if (shouldForceDeterministicRetry(flow, attempt, entryResult) && attempt.number === 1 && attempts.length > 1) {
					logAction(
						`openAppBySearchWithFallback(${app}): ${label} completed with shortcut+enter path; running deterministic tap-only retry before confirming launch`,
					);
					await runLaunchDebugStep(session, debugHooks, app, contextHint, {
						id: `retry-switch:${app}:attempt-${attempt.number}`,
						kind: "retry-switch",
						label: `Switch to deterministic retry for ${app}`,
						expected: "Run tap-only autonomous retry before confirming app launch success.",
						attemptNumber: attempt.number,
						attemptMode: attempt.mode,
				}, async () => {
					await sleepAfterAction("search-launch-deterministic-retry", CAPTURE_FAST_STEP_GAP_SEC);
				});
				continue;
			}
			logAction(`openAppBySearchWithFallback(${app}): search flow succeeded via ${label}`);
			return;
		} catch (error) {
			if (shouldAbortRetries(error)) {
				throw error;
			}
			lastError = error;
				const message = error instanceof Error ? error.message : String(error);
				logAction(`openAppBySearchWithFallback(${app}): ${label} failed: ${message}`);
				if (attempt.number < attempts.length) {
					logAction(`openAppBySearchWithFallback(${app}): retrying with next autonomous launch mode`);
					await runLaunchDebugStep(session, debugHooks, app, contextHint, {
						id: `retry-switch:${app}:attempt-${attempt.number}`,
						kind: "retry-switch",
						label: `Switch launch retry mode for ${app}`,
						expected: "Retry launch using the next autonomous mode.",
						attemptNumber: attempt.number,
						attemptMode: attempt.mode,
				}, async () => {
					await sleepAfterAction("search-launch-retry-switch", CAPTURE_FAST_STEP_GAP_SEC);
				});
			}
		}
	}

	if (lastError) {
		const message = lastError instanceof Error ? lastError.message : String(lastError);
		logAction(`openAppBySearchWithFallback(${app}): search attempts exhausted (${message}); falling back to home icon launch`);
	} else {
		logAction(`openAppBySearchWithFallback(${app}): search attempts exhausted; falling back to home icon launch`);
	}

	await runLaunchDebugStep(session, debugHooks, app, contextHint, {
		id: `home-fallback:${app}`,
		kind: "home-fallback",
		label: `Fallback to Home icon launch for ${app}`,
		expected: "Open app from Home icon fallback after search attempts are exhausted.",
		attemptMode: "home-fallback",
	}, async () => {
		await sleepAfterAction("search-fallback-switch", CAPTURE_FAST_STEP_GAP_SEC);
		await openAppFromHome(session, app);
	});
	logAction(`openAppBySearchWithFallback(${app}): home icon fallback completed`);
}

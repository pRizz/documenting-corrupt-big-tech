import {
	CAPTURE_FAST_STEP_GAP_SEC,
	CAPTURE_PRE_ACTION_DELAY_SEC,
	CAPTURE_STEP_GAP_SEC,
	CAPTURE_USE_MIRROR_SHORTCUTS,
	LOG_PREFIX,
	SUPPORTED_APPS,
	timestampSnapshot,
	sanitizeQueryForFilename,
	sleep,
	type SupportedApp,
	die,
	getAppFlowDefinition,
} from "../../utils";
import { logAction, sleepAfterAction } from "../timing";
import { mkdirSync } from "node:fs";
import type { AutomationSession } from "./session";
import { getCalibrationProfile } from "./profile-store";
import { openAppBySearchWithFallback, runAppSearchPlacement, runFlowPostLaunchActions } from "./app-launch";

export async function runAppFlow(
	session: AutomationSession,
	app: SupportedApp,
	query: string,
	outBase: string,
	querySlug: string,
): Promise<void> {
	const appDir = `${outBase}/${app}`;
	const flow = getAppFlowDefinition(app);
	session.focusMirroring();
	logAction(`Starting app flow for ${app} (query="${query}", outBase="${outBase}")`);
	await sleepAfterAction("focus-mirroring-init", CAPTURE_FAST_STEP_GAP_SEC);
	if (!(await session.ensureMirrorFrontmost(`run-app-${app}`))) {
		die(`Could not return focus to mirror host for ${app} flow.`);
	}
	await sleepAfterAction("run-app-frontmost", CAPTURE_FAST_STEP_GAP_SEC);
	session.logFrontmostState("run-app:post-focus");
	getCalibrationProfile(session);
	await openAppBySearchWithFallback(session, app);
	await runFlowPostLaunchActions(session, app, flow);
	await runAppSearchPlacement(session, app, flow);
	await session.clearField();
	await session.typeAndCapturePerChar(app, query, appDir, querySlug);
}

export async function runCaptureFlow(
	session: AutomationSession,
	query: string,
	apps: SupportedApp[],
	outDir?: string,
): Promise<string> {
	session.ensurePreflightChecks();
	if (!query || query.length === 0) {
		die("Query must not be empty");
	}
	if (apps.length === 0) {
		die("Missing --apps");
	}
	for (const app of apps) {
		if (!SUPPORTED_APPS.includes(app)) {
			die(`Unknown app '${app}'. Use chrome,instagram,tiktok.`);
		}
	}

	const baseDir = outDir && outDir.length > 0 ? outDir : `./autofill_shots_${timestampSnapshot()}`;
	mkdirSync(baseDir, { recursive: true });
	const querySlug = sanitizeQueryForFilename(query);
	console.log(`[${LOG_PREFIX}] Effective CAPTURE_PRE_ACTION_DELAY_SEC=${CAPTURE_PRE_ACTION_DELAY_SEC}`);
	console.log(`[${LOG_PREFIX}] Effective CAPTURE_STEP_GAP_SEC=${CAPTURE_STEP_GAP_SEC}`);
	console.log(`[${LOG_PREFIX}] Effective CAPTURE_FAST_STEP_GAP_SEC=${CAPTURE_FAST_STEP_GAP_SEC}`);
	console.log(`[${LOG_PREFIX}] Effective CAPTURE_USE_MIRROR_SHORTCUTS=${CAPTURE_USE_MIRROR_SHORTCUTS}`);

	if (CAPTURE_PRE_ACTION_DELAY_SEC > 0) {
		console.log(`Starting capture: waiting ${CAPTURE_PRE_ACTION_DELAY_SEC}s for mirroring/host to settle before actions...`);
		await sleep(CAPTURE_PRE_ACTION_DELAY_SEC);
	} else {
		console.log("Starting capture: no pre-action delay configured.");
	}

	for (const app of apps) {
		await runAppFlow(session, app, query, baseDir, querySlug);
	}

	console.log(`Done. Output: ${baseDir}`);
	return baseDir;
}

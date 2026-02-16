import {
	CAPTURE_FAST_STEP_GAP_SEC,
	type ActionPointsByApp,
	type AppFlowDefinition,
	type SupportedApp,
	die,
	getActionDefinition,
	parseActionId,
} from "../../utils";
import { logAction, sleepAfterAction } from "../timing";
import type { AutomationSession } from "./session";
import { getCalibrationProfile } from "./profile-store";
import { getActionPoint } from "./app-launch";

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

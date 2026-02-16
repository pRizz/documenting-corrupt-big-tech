import {
	APP_LAUNCH_RESULT_RX,
	APP_LAUNCH_RESULT_RY,
	BASE_COORDINATES_FILE,
	CAPTURE_FAST_STEP_GAP_SEC,
	CALIBRATION_SEARCH_BUTTON_PROMPT,
	CHROME_SEARCH_STEPS,
	INSTAGRAM_SEARCH_STEPS,
	TIKTOK_SEARCH_STEPS,
	type BaseCoordinatePoint,
	type BaseCoordinatesProfile,
	type Region,
	type SupportedApp,
	die,
	getActionDefinition,
} from "../../utils";
import { absToRelWithinRegion, parseBoundsTuple, relToAbsWithRegion } from "../geometry";
import { buildCalibrationTelemetry, formatCalibrationPreview, promptAndCapturePoint, queryMouseLocation } from "../calibration-ui";
import { sleepAfterAction } from "../timing";
import {
	backupExistingCalibrationProfile,
	getCalibrationProfile,
	getExistingCalibrationProfile,
	persistCalibrationProfile,
	updateActionPointInProfile,
} from "./profile-store";
import type { AutomationSession } from "./session";

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

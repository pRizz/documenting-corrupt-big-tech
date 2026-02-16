import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
	ACTION_CALIBRATION_DEFINITIONS,
	BASE_COORDINATES_FILE,
	SUPPORTED_APPS,
	type ActionPointsByApp,
	type BaseCoordinatePoint,
	type BaseCoordinatesProfile,
	type SupportedApp,
	type WindowBounds,
	die,
	trim,
} from "../../utils";
import type { Region } from "../../utils";
import { parseTapSteps } from "../geometry";
import { buildSnapshotCalibrationPath } from "../calibration-store";
import type { AutomationSession } from "./session";

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return Number.NaN;
	}
	return Math.max(0, Math.min(1, value));
}

function clamp01Checked(value: number, label: string): number {
	if (!Number.isFinite(value)) {
		die(`Invalid relative value in ${label}: ${value}`);
	}
	return clamp01(value);
}

function validateCalibrationValue(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		die(`Invalid ${label}: expected finite number.`);
	}
	return value;
}

function validateCalibrationPoint(value: unknown, label: string): BaseCoordinatePoint {
	if (typeof value !== "object" || value === null) {
		die(`Invalid ${label}: expected object.`);
	}
	const typed = value as Record<string, unknown>;
	const relX = validateCalibrationValue(typed.relX, `${label}.relX`);
	const relY = validateCalibrationValue(typed.relY, `${label}.relY`);
	const absX = typed.absX === undefined ? undefined : validateCalibrationValue(typed.absX, `${label}.absX`);
	const absY = typed.absY === undefined ? undefined : validateCalibrationValue(typed.absY, `${label}.absY`);
	return {
		relX: clamp01Checked(relX, `${label}.relX`),
		relY: clamp01Checked(relY, `${label}.relY`),
		absX,
		absY,
	};
}

export function createFallbackCalibrationErrorMessage(): string {
	return [
		`Missing or invalid base-coordinate calibration file: ${BASE_COORDINATES_FILE}.`,
		"Run: bun run capture -- --calibrate",
		"Then rerun your capture command.",
	].join(" ");
}

export function validateCalibrationProfile(rawProfile: unknown): BaseCoordinatesProfile {
	if (typeof rawProfile !== "object" || rawProfile === null) {
		die(createFallbackCalibrationErrorMessage());
	}
	const profile = rawProfile as Record<string, unknown>;

	const version = validateCalibrationValue(profile.version, "profile.version");
	if (!Number.isInteger(version) || version < 1) {
		die("Unsupported or invalid base-coordinate profile version.");
	}
	const generatedAt = typeof profile.generatedAt === "string" ? profile.generatedAt : "";
	if (generatedAt.length === 0) {
		die("Invalid profile.generatedAt: expected non-empty string.");
	}

	const mirrorWindowRaw = profile.mirrorWindow;
	if (typeof mirrorWindowRaw !== "object" || mirrorWindowRaw === null) {
		die("Invalid profile.mirrorWindow: expected bounds object.");
	}
	const mirrorWindowObj = mirrorWindowRaw as Record<string, unknown>;
	const mirrorWindow: WindowBounds = {
		x1: validateCalibrationValue(mirrorWindowObj.x1, "profile.mirrorWindow.x1"),
		y1: validateCalibrationValue(mirrorWindowObj.y1, "profile.mirrorWindow.y1"),
		x2: validateCalibrationValue(mirrorWindowObj.x2, "profile.mirrorWindow.x2"),
		y2: validateCalibrationValue(mirrorWindowObj.y2, "profile.mirrorWindow.y2"),
	};
	if (mirrorWindow.x2 <= mirrorWindow.x1 || mirrorWindow.y2 <= mirrorWindow.y1) {
		die("Invalid profile.mirrorWindow: empty or inverted bounds.");
	}

	const contentRegionRaw = profile.contentRegion;
	if (typeof contentRegionRaw !== "object" || contentRegionRaw === null) {
		die("Invalid profile.contentRegion: expected region object.");
	}
	const contentRegionObj = contentRegionRaw as Record<string, unknown>;
	const contentRegion: Region = {
		x: validateCalibrationValue(contentRegionObj.x, "profile.contentRegion.x"),
		y: validateCalibrationValue(contentRegionObj.y, "profile.contentRegion.y"),
		width: validateCalibrationValue(contentRegionObj.width, "profile.contentRegion.width"),
		height: validateCalibrationValue(contentRegionObj.height, "profile.contentRegion.height"),
	};
	if (contentRegion.width <= 0 || contentRegion.height <= 0) {
		die("Invalid profile.contentRegion: width/height must be greater than zero.");
	}

	const pointsRaw = profile.points;
	if (typeof pointsRaw !== "object" || pointsRaw === null) {
		die("Invalid profile.points: expected object.");
	}
	const pointsObj = pointsRaw as Record<string, unknown>;
	const homeSearchButton = validateCalibrationPoint(pointsObj.homeSearchButton, "profile.points.homeSearchButton");
	const launchResultTap = validateCalibrationPoint(pointsObj.launchResultTap, "profile.points.launchResultTap");

	const appSearchStepsRaw = pointsObj.appSearchSteps;
	if (typeof appSearchStepsRaw !== "object" || appSearchStepsRaw === null) {
		die("Invalid profile.points.appSearchSteps: expected map of app names to tap sequences.");
	}
	const appSearchStepsObj = appSearchStepsRaw as Record<string, unknown>;
	const appSearchSteps: Record<SupportedApp, string> = {
		chrome: "",
		instagram: "",
		tiktok: "",
	};
	for (const app of SUPPORTED_APPS) {
		const rawStep = appSearchStepsObj[app];
		if (typeof rawStep !== "string" || trim(rawStep).length === 0) {
			die(`Invalid profile.points.appSearchSteps.${app}: expected non-empty string.`);
		}
		try {
			parseTapSteps(rawStep, `profile.points.appSearchSteps.${app}`);
		} catch {
			die(`Invalid profile.points.appSearchSteps.${app}: ${rawStep}`);
		}
		appSearchSteps[app] = rawStep.trim();
	}

	const actionTargets = new Set(ACTION_CALIBRATION_DEFINITIONS.map((definition) => definition.id));
	const appActionPointsRaw = pointsObj.appActionPoints;
	const appActionPoints: ActionPointsByApp = {};
	if (appActionPointsRaw !== undefined) {
		if (typeof appActionPointsRaw !== "object" || appActionPointsRaw === null) {
			die("Invalid profile.points.appActionPoints: expected app map.");
		}
		const appActionPointsObj = appActionPointsRaw as Record<string, unknown>;
		for (const app of SUPPORTED_APPS) {
			const rawActionMap = appActionPointsObj[app];
			if (rawActionMap === undefined || rawActionMap === null || typeof rawActionMap !== "object") {
				continue;
			}
			const actionMap = rawActionMap as Record<string, unknown>;
			for (const [action, rawPoint] of Object.entries(actionMap)) {
				const actionTarget = `${app}:${action}`;
				if (!actionTargets.has(actionTarget)) {
					continue;
				}
				const parsedPoint = validateCalibrationPoint(rawPoint, `profile.points.appActionPoints.${app}.${action}`);
				if (!appActionPoints[app]) {
					appActionPoints[app] = {};
				}
				appActionPoints[app]![action] = parsedPoint;
			}
		}
	}

	return {
		version: Math.trunc(version),
		generatedAt,
		mirrorWindow,
		contentRegion,
		points: {
			homeSearchButton,
			launchResultTap,
			appSearchSteps,
			appActionPoints,
		},
	};
}

export function getCalibrationProfile(session: AutomationSession): BaseCoordinatesProfile {
	if (session.state.calibrationProfile) {
		return session.state.calibrationProfile;
	}
	if (!existsSync(BASE_COORDINATES_FILE)) {
		die(createFallbackCalibrationErrorMessage());
	}

	let raw: string;
	try {
		raw = readFileSync(BASE_COORDINATES_FILE, "utf8");
	} catch {
		die(createFallbackCalibrationErrorMessage());
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		die(createFallbackCalibrationErrorMessage());
	}

	const profile = validateCalibrationProfile(parsed);
	session.state.calibrationProfile = profile;
	return profile;
}

export function getExistingCalibrationProfile(session: AutomationSession): BaseCoordinatesProfile | undefined {
	try {
		if (!existsSync(BASE_COORDINATES_FILE)) {
			return undefined;
		}
		return getCalibrationProfile(session);
	} catch {
		return undefined;
	}
}

export function backupExistingCalibrationProfile(session: AutomationSession): string | undefined {
	if (!existsSync(BASE_COORDINATES_FILE)) {
		return undefined;
	}
	const snapshotPath = buildSnapshotCalibrationPath();
	renameSync(BASE_COORDINATES_FILE, snapshotPath);
	session.state.calibrationProfile = undefined;
	return snapshotPath;
}

export function persistCalibrationProfile(session: AutomationSession, profile: BaseCoordinatesProfile): void {
	mkdirSync(dirname(BASE_COORDINATES_FILE), { recursive: true });
	writeFileSync(BASE_COORDINATES_FILE, `${JSON.stringify(profile, null, 2)}\n`);
	session.state.calibrationProfile = profile;
}

export function updateActionPointInProfile(
	profile: BaseCoordinatesProfile,
	app: SupportedApp,
	action: string,
	point: BaseCoordinatePoint,
): BaseCoordinatesProfile {
	return {
		...profile,
		generatedAt: new Date().toISOString(),
		points: {
			...profile.points,
			appActionPoints: {
				...(profile.points.appActionPoints ?? {}),
				[app]: {
					...(profile.points.appActionPoints?.[app] ?? {}),
					[action]: point,
				},
			},
		},
	};
}

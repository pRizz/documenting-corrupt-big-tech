import type { WindowBounds, Region } from "../utils";
import {
	COORD_SCALE,
	INSET_BOTTOM,
	INSET_LEFT,
	INSET_RIGHT,
	INSET_TOP,
	RELATIVE_TOKEN_RE,
	type BaseCoordinatePoint,
	die,
	trim,
} from "../utils";
import { logPayload } from "../utils";

export function numericBoundsPayload(raw: string): boolean {
	return /^-?[0-9]+,-?[0-9]+,-?[0-9]+,-?[0-9]+$/.test(trim(raw));
}

export function parseBoundsTuple(raw: string): WindowBounds {
	const values = raw.split(",").map((value) => Number(trim(value)));
	if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
		die(`Could not parse bounds payload '${raw}'.`);
	}
	const x1 = values[0];
	const y1 = values[1];
	const x2 = values[2];
	const y2 = values[3];
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
		die(`Could not parse bounds payload '${raw}'.`);
	}
	return { x1, y1, x2, y2 };
}

export function validateRelativeToken(label: string, value: string): number {
	const normalized = trim(value);
	if (normalized.length === 0) {
		die(`Invalid relative token for ${label}: empty`);
	}
	if (!RELATIVE_TOKEN_RE.test(normalized)) {
		die(`Invalid relative token for ${label}: '${value}'`);
	}
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed)) {
		die(`Invalid relative token for ${label}: '${value}'`);
	}
	return parsed;
}

export function parseTapSteps(raw: string, label = "tap sequence"): [number, number][] {
	const steps = raw
		.split(";")
		.map(trim)
		.filter((entry) => entry.length > 0);
	if (steps.length === 0) {
		die(`Invalid ${label}: no steps.`);
	}

	const parsed: [number, number][] = [];
	for (const step of steps) {
		const tokens = step.split(",");
		if (tokens.length !== 2) {
			die(`Invalid ${label} step '${step}'. Expected 'x,y'.`);
		}
		const [rawX, rawY] = tokens;
		if (rawX === undefined || rawY === undefined) {
			die(`Invalid ${label} step '${step}'. Expected 'x,y'.`);
		}
		parsed.push([validateRelativeToken(`${label} x`, rawX), validateRelativeToken(`${label} y`, rawY)]);
	}

	return parsed;
}

export function escapeTapText(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/:/g, "\\:");
}

export function getContentRegion(bounds?: string): Region {
	const normalizedBounds = bounds ? trim(bounds) : "";
	if (typeof normalizedBounds !== "string" || normalizedBounds.length === 0) {
		die("Mirroring bounds were empty.");
	}
	const parsed = parseBoundsTuple(normalizedBounds);
	const windowWidth = parsed.x2 - parsed.x1;
	const windowHeight = parsed.y2 - parsed.y1;
	if (windowWidth <= 0 || windowHeight <= 0) {
		die(`Invalid mirroring window bounds: x1=${parsed.x1} y1=${parsed.y1} x2=${parsed.x2} y2=${parsed.y2}`);
	}

	let contentX = parsed.x1 + INSET_LEFT;
	let contentY = parsed.y1 + INSET_TOP;
	let contentWidth = windowWidth - INSET_LEFT - INSET_RIGHT;
	let contentHeight = windowHeight - INSET_TOP - INSET_BOTTOM;
	if (contentWidth <= 0 || contentHeight <= 0) {
		die("Invalid content region after applying insets.");
	}

	if (!Number.isInteger(COORD_SCALE) || COORD_SCALE < 1) {
		die("COORD_SCALE must be a positive integer (1 or greater).");
	}

	return {
		x: contentX * COORD_SCALE,
		y: contentY * COORD_SCALE,
		width: contentWidth * COORD_SCALE,
		height: contentHeight * COORD_SCALE,
	};
}

export function relToAbs(rx: number, ry: number, region: Region): [number, number] {
	const x = region.x + region.width * rx;
	const y = region.y + region.height * ry;
	const absX = Math.round(x);
	const absY = Math.round(y);
	if (!Number.isInteger(absX) || !Number.isInteger(absY)) {
		die(`rel_to_abs produced non-integer payload from rel (${rx}, ${ry}) in region (${region.x} ${region.y} ${region.width} ${region.height})`);
	}
	return [absX, absY];
}

export function relToAbsWithRegion(rx: number, ry: number, region: Region): [number, number] {
	const x = region.x + region.width * rx;
	const y = region.y + region.height * ry;
	const absX = Math.round(x);
	const absY = Math.round(y);
	if (!Number.isInteger(absX) || !Number.isInteger(absY)) {
		die(`rel_to_abs_with_region produced non-integer payload from rel (${rx}, ${ry}) in region (${region.x} ${region.y} ${region.width} ${region.height})`);
	}
	return [absX, absY];
}

export function absToRelWithinRegion(ax: number, ay: number, region: Region, label = "point"): [number, number] {
	if (region.width === 0 || region.height === 0) {
		die(`Invalid content region while converting absolute point (${ax}, ${ay}) for ${label}`);
	}
	const relX = (ax - region.x) / region.width;
	const relY = (ay - region.y) / region.height;
	if (!Number.isFinite(relX) || !Number.isFinite(relY)) {
		die(`Could not convert absolute point (${ax}, ${ay}) to relative for ${label}`);
	}
	if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
		die(
			[
				`Captured point for ${label} is outside the current mirrored content region.`,
				`screen=(${ax}, ${ay}) local=(${ax - region.x}, ${ay - region.y}) region=(x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}) rel=(${relX}, ${relY})`,
				`Open iPhone Mirroring, place the pointer on the target point for ${label}, then rerun:`,
				"bun run capture -- --calibrate",
			].join(" "),
		);
	}
	return [relX, relY];
}

export function absToRel(ax: number, ay: number, region: Region): [number, number] {
	if (region.width === 0 || region.height === 0) {
		die(`Invalid content region while converting abs (${ax}, ${ay})`);
	}
	return [(ax - region.x) / region.width, (ay - region.y) / region.height];
}

export function makeBasePointFromRel(rx: number, ry: number, region: Region): BaseCoordinatePoint {
	const [absX, absY] = relToAbsWithRegion(rx, ry, region);
	return { relX: rx, relY: ry, absX, absY };
}

export function validateRelativePair(x: number, y: number, label = "point"): void {
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		die(`Invalid relative coordinates for ${label}: (${x}, ${y})`);
	}
}

export function relToAbsWithRegionForLog(rx: number, ry: number, region: Region): [number, number] {
	return relToAbsWithRegion(rx, ry, region);
}

export function logContentRegionPayload(message: string, region: Region): void {
	logPayload(message, `x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);
}

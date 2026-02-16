import { die, logStep } from "../../utils";
import type { AutomationSession } from "./session";

export function printWindowMode(session: AutomationSession): void {
	session.ensurePreflightChecks();
	session.focusMirroring();
	const mirrorBounds = session.getMirrorWindowBounds();
	const contentRegion = session.getContentRegion(mirrorBounds);
	logStep("Computed window/content bounds successfully for diagnostics");
	console.log(`window: ${mirrorBounds}`);
	console.log(`content: ${contentRegion.x} ${contentRegion.y} ${contentRegion.width} ${contentRegion.height}`);
}

export function coordToRelMode(session: AutomationSession, x: number, y: number): void {
	session.ensurePreflightChecks();
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		die("Invalid numeric coordinate passed to coord-to-rel");
	}
	const [rx, ry] = session.absToRel(x, y);
	console.log(`${rx.toFixed(6)} ${ry.toFixed(6)}`);
}

export function pointCheckMode(session: AutomationSession, x: number, y: number): void {
	session.ensurePreflightChecks();
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		die("Invalid numeric coordinate passed to point-check");
	}
	const [absX, absY] = session.relToAbs(x, y);
	console.log(`rel (${x}, ${y}) => abs (${absX}, ${absY})`);
}

export function runPreflight(session: AutomationSession): void {
	session.ensurePreflightChecks();
	console.log("Preflight checks passed.");
}

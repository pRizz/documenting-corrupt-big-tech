import { SUPPORTED_APPS, type SupportedApp } from "../../utils";
import { createAutomationSession } from "./session";
import { runCaptureFlow } from "./capture";
import { calibrateAll, isCalibratableAction, listAvailableCalibrations } from "./calibration";
import { calibrateAction, calibrateMode } from "./calibration-basic";
import { debugCalibrateAll } from "./calibration-debug";
import { coordToRelMode, pointCheckMode, printWindowMode, runPreflight } from "./debug";

export type AutomationCommand =
	| { mode: "capture"; query: string; apps: SupportedApp[]; outDir?: string }
	| { mode: "print-window" }
	| { mode: "calibrate" }
	| { mode: "calibrate-action"; app: SupportedApp; action: string }
	| { mode: "calibrate-all" }
	| { mode: "debug-calibrate-all" }
	| { mode: "coord-to-rel"; x: number; y: number }
	| { mode: "point-check"; x: number; y: number }
	| { mode: "preflight" };

export async function runAutomationCommand(command: AutomationCommand): Promise<string | void> {
	const session = createAutomationSession();

	switch (command.mode) {
		case "capture":
			return runCaptureFlow(session, command.query, command.apps, command.outDir);
		case "print-window":
			return printWindowMode(session);
		case "calibrate":
			return calibrateMode(session);
		case "calibrate-action":
			return calibrateAction(session, command.app, command.action);
		case "calibrate-all":
			return calibrateAll(session);
		case "debug-calibrate-all":
			return debugCalibrateAll(session);
		case "coord-to-rel":
			return coordToRelMode(session, command.x, command.y);
		case "point-check":
			return pointCheckMode(session, command.x, command.y);
		case "preflight":
			return runPreflight(session);
		default:
			command satisfies never;
	}
}

export { SUPPORTED_APPS, listAvailableCalibrations, isCalibratableAction };

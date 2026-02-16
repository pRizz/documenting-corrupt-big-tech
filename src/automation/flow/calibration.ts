import { ACTION_CALIBRATION_DEFINITIONS, type ActionCalibrationDefinition, type SupportedApp } from "../../utils";
import { AutofillAutomation } from "../flow-legacy";

export function listAvailableCalibrations(): readonly ActionCalibrationDefinition[] {
	return ACTION_CALIBRATION_DEFINITIONS.filter((definition) => definition.id.includes(":"));
}

export function isCalibratableAction(app: SupportedApp, action: string): boolean {
	return ACTION_CALIBRATION_DEFINITIONS.some((definition) => definition.id === `${app}:${action}`);
}

export async function calibrateAction(
	automation: AutofillAutomation,
	app: SupportedApp,
	action: string,
): Promise<void> {
	await automation.calibrateAction(app, action);
}

export async function calibrateAll(
	automation: AutofillAutomation,
): Promise<void> {
	await automation.calibrateAll();
}

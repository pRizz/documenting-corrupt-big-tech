import type { SupportedApp } from "../../utils";

export interface CapturePlan {
	apps: SupportedApp[];
	query: string;
	outDir?: string;
}

export async function runCaptureFlow(
	automation: {
		captureMode: (query: string, apps: SupportedApp[], outDir?: string) => Promise<void>;
	},
	plan: CapturePlan,
): Promise<void> {
	await automation.captureMode(plan.query, plan.apps, plan.outDir);
}

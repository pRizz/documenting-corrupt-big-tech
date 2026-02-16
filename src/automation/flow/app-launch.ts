import type { SupportedApp } from "../../utils";

export type AppLaunchState = {
	currentApp?: SupportedApp;
	lastState?: "ready" | "launched" | "failed";
};

export async function runAppFlow(
	automation: { runAppFlow: (app: SupportedApp, query: string, outDir: string, querySlug: string) => Promise<void> },
	app: SupportedApp,
	query: string,
	outDir: string,
	querySlug: string,
): Promise<void> {
	await automation.runAppFlow(app, query, outDir, querySlug);
}

export function makeAppLaunchState(app?: SupportedApp): AppLaunchState {
	return { currentApp: app, lastState: app ? "ready" : undefined };
}

export function markAppLaunchStarted(state: AppLaunchState): void {
	state.lastState = "launched";
}

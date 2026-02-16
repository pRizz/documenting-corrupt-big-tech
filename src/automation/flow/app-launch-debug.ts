import type { SupportedApp } from "../../utils";

export type AppLaunchContextHint = "unknown" | "search-entry-active";

export type AppLaunchDebugStepKind =
	| "acquire-search-entry"
	| "clear-field"
	| "type-query"
	| "submit-launch"
	| "retry-switch"
	| "home-fallback";

export interface AppLaunchDebugStep {
	id: string;
	kind: AppLaunchDebugStepKind;
	label: string;
	expected: string;
	app: SupportedApp;
	attemptNumber?: number;
	attemptMode?: string;
	contextHint: AppLaunchContextHint;
}

export interface AppLaunchStepFocusProbe {
	ensurePhase: string;
	ensuredFrontmost?: boolean;
	frontmostBeforeFocus?: string;
	frontmostAfterFocus?: string;
	frontmostBeforeAction?: string;
	frontmostAfterAction?: string;
}

export interface AppLaunchDebugHooks {
	beforeStep?: (step: AppLaunchDebugStep) => Promise<void> | void;
	afterStep?: (step: AppLaunchDebugStep, focusProbe?: AppLaunchStepFocusProbe) => Promise<void> | void;
	onStepError?: (step: AppLaunchDebugStep, error: unknown, focusProbe?: AppLaunchStepFocusProbe) => Promise<void> | void;
}

export async function runAppLaunchDebugStep(
	hooks: AppLaunchDebugHooks | undefined,
	step: AppLaunchDebugStep,
	action: () => Promise<void>,
	focusProbe?: AppLaunchStepFocusProbe,
): Promise<void> {
	try {
		await hooks?.beforeStep?.(step);
		await action();
		await hooks?.afterStep?.(step, focusProbe);
	} catch (error) {
		await hooks?.onStepError?.(step, error, focusProbe);
		throw error;
	}
}

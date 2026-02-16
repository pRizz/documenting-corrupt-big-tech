import { type SupportedApp, die } from "../../utils";
import { logAction } from "../timing";
import type { AutomationSession } from "./session";
import {
	runAppLaunchDebugStep,
	type AppLaunchContextHint,
	type AppLaunchDebugHooks,
	type AppLaunchDebugStep,
	type AppLaunchStepFocusProbe,
} from "./app-launch-debug";

interface LaunchStepDefinition extends Omit<AppLaunchDebugStep, "app" | "contextHint"> {}

function buildLaunchDebugStep(app: SupportedApp, contextHint: AppLaunchContextHint, step: LaunchStepDefinition): AppLaunchDebugStep {
	return {
		...step,
		app,
		contextHint,
	};
}

function readFrontmostProcess(session: AutomationSession, stepId: string, phase: string): string {
	try {
		return session.getFrontmostProcess();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logAction(`launch-step(${stepId}): frontmost probe failed at ${phase}: ${message}`);
		return "unknown";
	}
}

export async function runLaunchStepWithFocus(
	session: AutomationSession,
	debugHooks: AppLaunchDebugHooks | undefined,
	app: SupportedApp,
	contextHint: AppLaunchContextHint,
	step: LaunchStepDefinition,
	action: () => Promise<void>,
): Promise<void> {
	const launchStep = buildLaunchDebugStep(app, contextHint, step);
	const focusProbe: AppLaunchStepFocusProbe = {
		ensurePhase: `launch-step:${launchStep.id}:pre`,
	};

	await runAppLaunchDebugStep(
		debugHooks,
		launchStep,
		async () => {
			focusProbe.frontmostBeforeFocus = readFrontmostProcess(session, launchStep.id, "before-focus");
			logAction(
				`launch-step(${launchStep.id}): focus restore attempt phase=${focusProbe.ensurePhase} frontmostBefore=${focusProbe.frontmostBeforeFocus}`,
			);
			focusProbe.ensuredFrontmost = await session.ensureMirrorFrontmost(focusProbe.ensurePhase);
			focusProbe.frontmostAfterFocus = readFrontmostProcess(session, launchStep.id, "after-focus");
			logAction(
				`launch-step(${launchStep.id}): focus restore result ensured=${String(focusProbe.ensuredFrontmost)} frontmostAfter=${focusProbe.frontmostAfterFocus}`,
			);
			if (!focusProbe.ensuredFrontmost) {
				die(`Could not ensure mirror host before launch step '${launchStep.id}'.`);
			}
			focusProbe.frontmostBeforeAction = focusProbe.frontmostAfterFocus;
			await action();
			focusProbe.frontmostAfterAction = readFrontmostProcess(session, launchStep.id, "after-action");
			logAction(`launch-step(${launchStep.id}): action complete frontmostAfterAction=${focusProbe.frontmostAfterAction}`);
		},
		focusProbe,
	);
}

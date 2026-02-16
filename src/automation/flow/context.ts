import type { SupportedApp } from "../../utils";
import type { FlowRuntimeContext, RuntimeInput } from "../types";
import { APP_FLOW_DEFINITIONS, getAppFlowDefinition } from "../../utils";

export function createFlowContext(application: SupportedApp, label?: string): FlowRuntimeContext {
	return {
		currentApp: application,
		currentLabel: label,
	};
}

export function resolveFlowDefinition(application: SupportedApp) {
	return getAppFlowDefinition(application) ?? APP_FLOW_DEFINITIONS[application];
}

export function buildRuntimeInput(input: RuntimeInput): RuntimeInput {
	return {
		application: input.application,
		label: input.label,
	};
}

export function getCurrentContext(context: FlowRuntimeContext): {
	application?: SupportedApp | undefined;
	label?: string | undefined;
} {
	return {
		application: context.currentApp,
		label: context.currentLabel,
	};
}

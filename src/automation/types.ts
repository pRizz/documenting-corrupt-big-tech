import type { ActionContext, BaseCoordinatesProfile, SupportedApp } from "../utils";

export interface FlowRuntimeContext {
	calibrationProfile?: BaseCoordinatesProfile;
	calibrationContext?: RuntimeAppContext;
	currentApp?: SupportedApp;
	currentLabel?: string;
}

export interface RuntimeServices {
	ensurePreflightChecks: () => void;
}

export interface RuntimeInput {
	application: SupportedApp;
	label?: string;
}

export type MouseLocationSample = {
	x: number;
	y: number;
	source: string;
	raw: string;
};

export type CalibrationTelemetrySample = {
	x: number;
	y: number;
	relX: number;
	relY: number;
	source: string;
	raw: string;
	localX: number;
	localY: number;
	inBounds: boolean;
};

export type CalibrationTelemetryPanelState = {
	lines: number;
};

export type RuntimeAppContext = {
	currentApp?: SupportedApp;
	currentContext?: ActionContext;
};

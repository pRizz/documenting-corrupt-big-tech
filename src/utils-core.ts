export type SupportedApp = "chrome" | "instagram" | "tiktok";

export const SUPPORTED_APPS: ReadonlyArray<SupportedApp> = ["chrome", "instagram", "tiktok"];

export type AppFlowMode =
	| "capture"
	| "print-window"
	| "calibrate"
	| "calibrate-action"
	| "calibrate-all"
	| "coord-to-rel"
	| "point-check";

export interface CliConfig {
	query?: string;
	apps?: SupportedApp[];
	out?: string;
	printWindow?: boolean;
	calibrate?: boolean;
	calibrateAction?: string;
	calibrateAll?: boolean;
	coordToRel?: [number, number];
	pointCheck?: [number, number];
}

export interface WindowBounds {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type SearchEntryMode = "shortcut" | "searchIcon" | "homeThenSearchIcon" | "legacyHomeIconOnly";
export type ActionContext = "home" | "app-launch" | "search-focused" | "search-entry" | "app-active" | "custom";
export type SearchSubmitMode = "enter" | "tapResult";

export interface AppFlowDefinition {
	app: SupportedApp;
	launch: SearchEntryMode;
	searchSubmitMode: SearchSubmitMode;
	postLaunchActions?: string[];
	searchActions?: {
		inAppSearchPoint?: string;
		fallbackSearchSteps?: string;
	};
	requiredCalibrationForCapture?: string[];
}

export interface BaseCoordinatePoint {
	relX: number;
	relY: number;
	absX?: number;
	absY?: number;
}

export type ActionPointByAppName = Partial<Record<string, BaseCoordinatePoint>>;
export type ActionPointsByApp = Partial<Record<SupportedApp, ActionPointByAppName>>;

export interface BaseCoordinatesProfile {
	version: number;
	generatedAt: string;
	mirrorWindow: WindowBounds;
	contentRegion: Region;

	points: {
		homeSearchButton: BaseCoordinatePoint;
		launchResultTap: BaseCoordinatePoint;
		appSearchSteps: Record<SupportedApp, string>;
		appActionPoints?: ActionPointsByApp;
	};
}

export interface ActionCalibrationDefinition {
	id: string;
	label: string;
	forApp: SupportedApp;
	fallbackTapSteps?: string;
	requiredForCapture?: boolean;
	skipInCalibrateAll?: boolean;
	requirementsHint?: string;
	autoNavigateTo?: ActionContext;
	autoNavigateFrom?: ActionContext;
	prerequisites?: string[];
	captureHint?: string;
}

export interface CalibratableActionTransition {
	id: string;
	label: string;
	forApp: SupportedApp;
	requiredForCapture?: boolean;
	prerequisites?: string[];
}

export const LOG_PREFIX = "iphone-mirror-autofill";

export const MIRROR_APP_NAME = "iPhone Mirroring";
export const MIRROR_APP_FALLBACK = "QuickTime Player";
export const MIRROR_HOME_SHORTCUT_KEY = "1";
export const MIRROR_SEARCH_SHORTCUT_KEY = "3";

export const INSET_LEFT = 10;
export const INSET_TOP = 48;
export const INSET_RIGHT = 10;
export const INSET_BOTTOM = 10;

export const COORD_SCALE = 1;

export const CHAR_DELAY_SEC = 4;
export const APP_OPEN_DELAY_SEC = 4;
export const CLEAR_MODE = "select_all";
export const BACKSPACE_COUNT = 40;

export const BASE_COORDINATES_FILE = "./calibration/base-coordinates.json";

export const APP_LAUNCH_QUERY: Readonly<Record<SupportedApp, string>> = {
	chrome: "Chrome",
	instagram: "Instagram",
	tiktok: "TikTok",
};

export const APP_HOME_SEARCH_RX = 0.5;
export const APP_HOME_SEARCH_RY = 0.91;
export const APP_LAUNCH_RESULT_RX = 0.5;
export const APP_LAUNCH_RESULT_RY = 0.63;

export const CALIBRATION_PREVIEW_INTERVAL_MS = 150;

export const CALIBRATION_PROMPT_HEADER = "🔧 Calibration: interactive coordinate capture";
export const CALIBRATION_SEARCH_BUTTON_PROMPT = "Target: iPhone Home Screen Search button";

export const CHROME_ICON_RX = 0.18;
export const CHROME_ICON_RY = 0.78;
export const INSTAGRAM_ICON_RX = 0.40;
export const INSTAGRAM_ICON_RY = 0.78;
export const TIKTOK_ICON_RX = 0.62;
export const TIKTOK_ICON_RY = 0.78;

export const CHROME_SEARCH_STEPS = "0.50,0.10";
export const INSTAGRAM_SEARCH_STEPS = "0.20,0.95;0.50,0.12";
export const TIKTOK_SEARCH_STEPS = "0.92,0.08;0.50,0.12";

export const APP_FLOW_DEFINITIONS: Readonly<Record<SupportedApp, AppFlowDefinition>> = {
	chrome: {
		app: "chrome",
		launch: "shortcut",
		searchSubmitMode: "enter",
		postLaunchActions: ["chrome:ellipsis", "chrome:newIncognitoTab"],
		searchActions: {
			inAppSearchPoint: "searchBar",
			fallbackSearchSteps: CHROME_SEARCH_STEPS,
		},
		requiredCalibrationForCapture: ["chrome:ellipsis", "chrome:newIncognitoTab"],
	},
	instagram: {
		app: "instagram",
		launch: "shortcut",
		searchSubmitMode: "enter",
		searchActions: {
			fallbackSearchSteps: INSTAGRAM_SEARCH_STEPS,
		},
	},
	tiktok: {
		app: "tiktok",
		launch: "shortcut",
		searchSubmitMode: "enter",
		searchActions: {
			fallbackSearchSteps: TIKTOK_SEARCH_STEPS,
		},
	},
};

export const ACTION_CALIBRATION_DEFINITIONS: ReadonlyArray<ActionCalibrationDefinition> = [
	{
		id: "chrome:ellipsis",
		label: "Chrome ellipsis/options",
		forApp: "chrome",
		autoNavigateTo: "app-active",
		requirementsHint: "Open Chrome and tap the ellipsis/options button before the incognito action.",
		requiredForCapture: true,
	},
	{
		id: "chrome:newIncognitoTab",
		label: "Chrome new incognito tab",
		forApp: "chrome",
		autoNavigateTo: "app-active",
		prerequisites: ["chrome:ellipsis"],
		requiredForCapture: true,
	},
	{
		id: "chrome:searchBar",
		label: "Chrome search bar",
		forApp: "chrome",
		autoNavigateTo: "search-focused",
		prerequisites: ["chrome:ellipsis", "chrome:newIncognitoTab"],
		fallbackTapSteps: CHROME_SEARCH_STEPS,
	},
	{
		id: "chrome:searchIcon",
		label: "Chrome search icon",
		forApp: "chrome",
		autoNavigateTo: "search-entry",
	},
	{
		id: "instagram:searchIcon",
		label: "Instagram search icon",
		forApp: "instagram",
		autoNavigateTo: "search-entry",
	},
	{
		id: "tiktok:searchIcon",
		label: "TikTok search icon",
		forApp: "tiktok",
		autoNavigateTo: "search-entry",
	},
	{
		id: "chrome:homeIcon",
		label: "Chrome home icon",
		forApp: "chrome",
		autoNavigateTo: "home",
	},
	{
		id: "instagram:homeIcon",
		label: "Instagram home icon",
		forApp: "instagram",
		autoNavigateTo: "home",
	},
	{
		id: "tiktok:homeIcon",
		label: "TikTok home icon",
		forApp: "tiktok",
		autoNavigateTo: "home",
	},
];

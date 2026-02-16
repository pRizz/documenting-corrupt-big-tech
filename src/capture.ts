import type { AppFlowMode, CliConfig, SupportedApp } from "./utils";
import { die, formatUsage, parseActionTarget, parseNumberToken } from "./utils";
import { runAutomationCommand, SUPPORTED_APPS, type AutomationCommand } from "./automation";

export interface ParsedCapturePlan {
	mode: AppFlowMode;
	config: CliConfig;
	showHelp: boolean;
	helpExitCode: number;
}

function parseApps(value: string): SupportedApp[] {
	const entries = value
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);

	if (entries.length === 0) {
		return [];
	}

	for (const app of entries) {
		if (!SUPPORTED_APPS.includes(app as SupportedApp)) {
			die(`Unknown app '${app}'. Use chrome,instagram,tiktok.`);
		}
	}

	return entries as SupportedApp[];
}

export function parseCaptureArgs(argv: string[]): ParsedCapturePlan {
	if (argv.length === 0) {
		return {
			mode: "capture",
			config: {},
			showHelp: true,
			helpExitCode: 1,
		};
	}

	let mode: AppFlowMode = "capture";
	let explicitModeSet = false;
	const config: CliConfig = {};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		switch (arg) {
			case "-h":
			case "--help":
				return {
					mode: "capture",
					config: {},
					showHelp: true,
					helpExitCode: 0,
				};
			case "--query": {
				if (index + 1 >= argv.length) {
					die("--query requires a value");
				}
				const rawQuery = argv[index + 1];
				if (rawQuery === undefined) {
					die("--query requires a value");
				}
				config.query = rawQuery;
				index += 1;
				break;
			}
			case "--apps": {
				if (index + 1 >= argv.length) {
					die("--apps requires a value");
				}
				const rawApps = argv[index + 1];
				if (rawApps === undefined) {
					die("--apps requires a value");
				}
				config.apps = parseApps(rawApps);
				index += 1;
				break;
			}
			case "--out": {
				if (index + 1 >= argv.length) {
					die("--out requires a value");
				}
				const rawOut = argv[index + 1];
				if (rawOut === undefined) {
					die("--out requires a value");
				}
				config.out = rawOut;
				index += 1;
				break;
			}
			case "--print-window": {
				if (explicitModeSet && mode !== "print-window") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "print-window";
				config.printWindow = true;
				break;
			}
			case "--calibrate": {
				if (explicitModeSet && mode !== "calibrate") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "calibrate";
				config.calibrate = true;
				break;
			}
			case "--calibrate-action": {
				if (explicitModeSet && mode !== "calibrate-action") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "calibrate-action";
				if (index + 1 >= argv.length) {
					die("--calibrate-action requires a value");
				}
				const rawCalibrateAction = argv[index + 1];
				if (rawCalibrateAction === undefined) {
					die("--calibrate-action requires a value");
				}
				parseActionTarget(rawCalibrateAction);
				config.calibrateAction = rawCalibrateAction;
				index += 1;
				break;
			}
			case "--calibrate-all": {
				if (explicitModeSet && mode !== "calibrate-all") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "calibrate-all";
				config.calibrateAll = true;
				break;
			}
			case "--coord-to-rel": {
				if (index + 2 >= argv.length) {
					die("--coord-to-rel requires X and Y");
				}
				if (explicitModeSet && mode !== "coord-to-rel") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "coord-to-rel";
				const x = argv[index + 1];
				const y = argv[index + 2];
				if (x === undefined || y === undefined) {
					die("--coord-to-rel requires X and Y");
				}
				config.coordToRel = [
					parseNumberToken("--coord-to-rel X", x),
					parseNumberToken("--coord-to-rel Y", y),
				];
				index += 2;
				break;
			}
			case "--point-check": {
				if (index + 2 >= argv.length) {
					die("--point-check requires RX and RY");
				}
				if (explicitModeSet && mode !== "point-check") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "point-check";
				const x = argv[index + 1];
				const y = argv[index + 2];
				if (x === undefined || y === undefined) {
					die("--point-check requires RX and RY");
				}
				config.pointCheck = [
					parseNumberToken("--point-check X", x),
					parseNumberToken("--point-check Y", y),
				];
				index += 2;
				break;
			}
			default:
				die(`Unknown argument: ${arg}`);
		}
	}

	if (mode === "capture") {
		if (!config.query || config.query.length === 0) {
			die("Missing --query");
		}
		if (!config.apps || config.apps.length === 0) {
			die("Missing --apps");
		}
	}

	return {
		mode,
		config,
		showHelp: false,
		helpExitCode: 0,
	};
}

export async function runCaptureMode(plan: ParsedCapturePlan): Promise<void> {
	if (plan.showHelp) {
		console.log(formatUsage());
		if (plan.helpExitCode !== 0) {
			process.exit(plan.helpExitCode);
		}
		return;
	}

	const command = buildAutomationCommand(plan);
	await runAutomationCommand(command);
}

function buildAutomationCommand(plan: ParsedCapturePlan): AutomationCommand {
	switch (plan.mode) {
		case "print-window":
			return { mode: "print-window" };
		case "calibrate":
			return { mode: "calibrate" };
		case "calibrate-action": {
			if (!plan.config.calibrateAction) {
				die("Missing --calibrate-action arguments.");
			}
			const { app, action } = parseActionTarget(plan.config.calibrateAction);
			return { mode: "calibrate-action", app, action };
		}
		case "calibrate-all":
			return { mode: "calibrate-all" };
		case "coord-to-rel": {
			if (!plan.config.coordToRel) {
				die("Missing --coord-to-rel arguments.");
			}
			const [x, y] = plan.config.coordToRel;
			if (x === undefined || y === undefined) {
				die("Missing --coord-to-rel arguments.");
			}
			return { mode: "coord-to-rel", x, y };
		}
		case "point-check": {
			if (!plan.config.pointCheck) {
				die("Missing --point-check arguments.");
			}
			const [x, y] = plan.config.pointCheck;
			if (x === undefined || y === undefined) {
				die("Missing --point-check arguments.");
			}
			return { mode: "point-check", x, y };
		}
		case "capture":
			if (!plan.config.query || !plan.config.apps) {
				die("Missing --query and/or --apps.");
			}
			return {
				mode: "capture",
				query: plan.config.query,
				apps: plan.config.apps,
				outDir: plan.config.out,
			};
		default:
			die(`Unsupported mode '${plan.mode}'.`);
	}
}

export async function runCapture(argv: string[]): Promise<void> {
	const plan = parseCaptureArgs(argv);
	if (plan.showHelp) {
		console.log(formatUsage());
		if (plan.helpExitCode !== 0) {
			process.exit(plan.helpExitCode);
		}
		return;
	}
	await runCaptureMode(plan);
}

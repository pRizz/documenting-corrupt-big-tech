import { AppFlowMode, CliConfig, SupportedApp, die, formatUsage, parseNumberToken } from "./utils";
import { AutofillAutomation, SUPPORTED_APPS } from "./automation";

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
				config.query = argv[index + 1];
				index += 1;
				break;
			}
			case "--apps": {
				if (index + 1 >= argv.length) {
					die("--apps requires a value");
				}
				config.apps = parseApps(argv[index + 1]);
				index += 1;
				break;
			}
			case "--out": {
				if (index + 1 >= argv.length) {
					die("--out requires a value");
				}
				config.out = argv[index + 1];
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
			case "--coord-to-rel": {
				if (index + 2 >= argv.length) {
					die("--coord-to-rel requires X and Y");
				}
				if (explicitModeSet && mode !== "coord-to-rel") {
					die("Only one mode flag may be provided.");
				}
				explicitModeSet = true;
				mode = "coord-to-rel";
				config.coordToRel = [
					parseNumberToken("--coord-to-rel X", argv[index + 1]),
					parseNumberToken("--coord-to-rel Y", argv[index + 2]),
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
				config.pointCheck = [
					parseNumberToken("--point-check RX", argv[index + 1]),
					parseNumberToken("--point-check RY", argv[index + 2]),
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

	const automation = new AutofillAutomation();

	switch (plan.mode) {
		case "print-window":
			await automation.printWindowMode();
			return;
		case "calibrate":
			await automation.calibrateMode();
			return;
		case "coord-to-rel": {
			if (!plan.config.coordToRel) {
				die("Missing --coord-to-rel arguments.");
			}
			await automation.coordToRelMode(plan.config.coordToRel[0], plan.config.coordToRel[1]);
			return;
		}
		case "point-check": {
			if (!plan.config.pointCheck) {
				die("Missing --point-check arguments.");
			}
			await automation.pointCheckMode(plan.config.pointCheck[0], plan.config.pointCheck[1]);
			return;
		}
		case "capture":
			if (!plan.config.query || !plan.config.apps) {
				die("Missing --query and/or --apps.");
			}
			await automation.captureMode(plan.config.query, plan.config.apps, plan.config.out);
			return;
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

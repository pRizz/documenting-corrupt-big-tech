import { clearLine, createInterface, cursorTo, moveCursor } from "node:readline";
import { CALIBRATION_PREVIEW_INTERVAL_MS, CALIBRATION_PROMPT_HEADER, trim } from "../utils";
import { asCommandResult } from "./command-bridge";
import type { Region } from "../utils";
import type { CalibrationTelemetryPanelState, CalibrationTelemetrySample, MouseLocationSample } from "./types";

export function parseMouseLocation(raw: string): [number, number] {
	const candidates = [
		raw.match(/^\s*\{?\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\}?\s*$/),
		raw.match(/x:\s*([+-]?\d+(?:\.\d+)?)\s*,\s*y:\s*([+-]?\d+(?:\.\d+)?)\s*/i),
	];

	for (const match of candidates) {
		if (match === null) continue;
		const x = Number(match[1]);
		const y = Number(match[2]);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			return [x, y];
		}
	}

	throw new Error(
		`Unable to parse mouse coordinates from '${raw}'. Expected formats like "{x, y}" or "x, y".`,
	);
}

export function queryMouseLocation(): MouseLocationSample {
	try {
		const osaResult = asCommandResult("osascript", [
			"-e",
			`tell application "System Events"
set mouseXY to mouse location
return mouseXY
end tell`,
		]);
		if (osaResult.exitCode !== 0) {
			throw new Error(trim(osaResult.output));
		}
		const osaOutput = trim(osaResult.output);
		const [x, y] = parseMouseLocation(osaOutput);
		return { x, y, source: "osascript", raw: osaOutput };
	} catch {
		const cliclickResult = asCommandResult("cliclick", ["p"]);
		if (cliclickResult.exitCode !== 0) {
			throw new Error(
				`Unable to read mouse location. Ensure Accessibility permissions are enabled for Terminal/System Events and try again.`,
			);
		}
		const raw = trim(cliclickResult.output);
		const [x, y] = parseMouseLocation(raw);
		return { x, y, source: "cliclick", raw };
	}
}

export function splitForTerminalWidth(text: string, width: number): string[] {
	const columns = Math.max(1, Math.floor(width));
	const paragraphs = text.split("\n");
	const result: string[] = [];
	for (const paragraph of paragraphs) {
		const segmenter =
			typeof Intl !== "undefined" && "Segmenter" in Intl
				? new Intl.Segmenter(undefined, { granularity: "grapheme" })
				: null;

		const graphemes: string[] = [];
		if (segmenter) {
			for (const segment of segmenter.segment(paragraph)) {
				graphemes.push(segment.segment);
			}
		} else {
			for (const segment of paragraph) {
				graphemes.push(segment);
			}
		}

		if (graphemes.length === 0) {
			result.push("");
			continue;
		}

		let cursor = 0;
		while (cursor < graphemes.length) {
			const line = graphemes.slice(cursor, cursor + columns).join("");
			result.push(line);
			cursor += columns;
		}
	}

	return result;
}

export function buildCalibrationTelemetry(sample: MouseLocationSample, region: Region): CalibrationTelemetrySample {
	const localX = sample.x - region.x;
	const localY = sample.y - region.y;
	const relX = region.width === 0 ? Number.NaN : localX / region.width;
	const relY = region.height === 0 ? Number.NaN : localY / region.height;
	const relXSafe = Number.isFinite(relX) ? relX : Number.NaN;
	const relYSafe = Number.isFinite(relY) ? relY : Number.NaN;
	const inBounds =
		Number.isFinite(relXSafe) &&
		Number.isFinite(relYSafe) &&
		relXSafe >= 0 &&
		relXSafe <= 1 &&
		relYSafe >= 0 &&
		relYSafe <= 1;

	return {
		x: sample.x,
		y: sample.y,
		relX: relXSafe,
		relY: relYSafe,
		source: sample.source,
		raw: sample.raw,
		localX,
		localY,
		inBounds,
	};
}

export function formatCalibrationPreview(label: string, sample: CalibrationTelemetrySample, region: Region): string {
	const relText = Number.isFinite(sample.relX) && Number.isFinite(sample.relY)
		? `(${sample.relX.toFixed(6)}, ${sample.relY.toFixed(6)})`
		: "(NaN, NaN)";
	const boundsText = sample.inBounds ? "" : " [OUT OF CONTENT REGION]";
	return (
		`Calibration preview [${label}]: source=${sample.source} raw=${sample.raw} | ` +
		`screen=(${sample.x}, ${sample.y}) | contentRegion=(x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}) | ` +
		`contentLocal=(${sample.localX}, ${sample.localY}) | rel=${relText}${boundsText}`
	);
}

export function renderPreviewPanel(text: string, previous: CalibrationTelemetryPanelState): CalibrationTelemetryPanelState {
	if (!process.stdout.isTTY) {
		console.log(text);
		return { lines: 1 };
	}

	const width = Math.max(20, process.stdout.columns ?? 120);
	const lines = splitForTerminalWidth(text, width);
	const targetLines = Math.max(previous.lines, lines.length);
	const moveUp = Math.max(0, previous.lines - 1);

	if (moveUp > 0) {
		moveCursor(process.stdout, 0, -moveUp);
		cursorTo(process.stdout, 0);
	}

	for (let i = 0; i < targetLines; i += 1) {
		clearLine(process.stdout, 0);
		cursorTo(process.stdout, 0);
		if (i < lines.length) {
			process.stdout.write(lines[i] ?? "");
		}
		if (i < targetLines - 1) {
			process.stdout.write("\n");
		}
	}

	cursorTo(process.stdout, 0);
	return { lines: lines.length };
}

export function resetPreviewPanel(previous: CalibrationTelemetryPanelState): void {
	if (!process.stdout.isTTY || previous.lines <= 0) {
		return;
	}

	const moveUp = Math.max(0, previous.lines - 1);
	moveCursor(process.stdout, 0, -moveUp);
	cursorTo(process.stdout, 0);
	for (let i = 0; i < previous.lines; i += 1) {
		clearLine(process.stdout, 0);
		cursorTo(process.stdout, 0);
		if (i < previous.lines - 1) {
			process.stdout.write("\n");
		}
	}
}

export function promptAndCapturePoint(label: string, contentRegion: Region): Promise<void> {
	console.log(CALIBRATION_PROMPT_HEADER);
	console.log(`Next: ${label}`);
	console.log("  - Move your mouse pointer over the target point in the mirrored iPhone.");
	console.log("  - Keep both this terminal and the iPhone mirroring window visible.");
	console.log("  - Make sure this terminal is focused before pressing Enter.");
	console.log("  - Press Enter to sample that point.");
	console.log("  - Press Ctrl+C to cancel.");

	return new Promise<void>((resolve, reject) => {
		const state: CalibrationTelemetryPanelState = { lines: 0 };
		let interval: ReturnType<typeof setInterval> | null = null;
		let resolved = false;

		const rl = createInterface({ input: process.stdin, output: process.stdout });

		const renderTelemetry = () => {
			let sample: MouseLocationSample;
			try {
				sample = queryMouseLocation();
			} catch {
				return;
			}
			const telemetry = buildCalibrationTelemetry(sample, contentRegion);
			const line = formatCalibrationPreview(label, telemetry, contentRegion);
			state.lines = renderPreviewPanel(line, state).lines;
		};

		const finalize = (error?: Error) => {
			if (resolved) return;
			resolved = true;
			if (interval !== null) {
				clearInterval(interval);
				interval = null;
			}
			resetPreviewPanel(state);
			process.stdout.write("\n");
			rl.close();
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};

		interval = setInterval(renderTelemetry, CALIBRATION_PREVIEW_INTERVAL_MS);
		renderTelemetry();

		rl.once("line", () => {
			finalize();
		});
		rl.once("close", () => {
			finalize();
		});
		rl.on("SIGINT", () => {
			finalize(new Error("Calibration prompt canceled by user."));
		});
	});
}

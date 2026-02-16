import { die, logPayload, trim } from "../utils";

export interface CommandResult {
	exitCode: number;
	output: string;
}

export function asCommandResult(command: string, args: string[]): CommandResult {
	const proc = Bun.spawnSync([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = proc.stdout ? proc.stdout.toString() : "";
	const stderr = proc.stderr ? proc.stderr.toString() : "";
	return { exitCode: proc.exitCode, output: `${stdout}${stderr}` };
}

export function needCmd(cmd: string, hint = ""): void {
	if (!Bun.which(cmd)) {
		die(hint ? `Missing required command: ${cmd}. ${hint}` : `Missing required command: ${cmd}.`);
	}
}

export function runOsa(script: string): string {
	const result = asCommandResult("osascript", ["-e", script]);
	if (result.exitCode !== 0) {
		if (result.output.length > 0) {
			logPayload("osascript output", trim(result.output));
		}
		die("AppleScript call failed. Ensure Accessibility and Automation permissions include your terminal app.");
	}
	return trim(result.output);
}

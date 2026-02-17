import process from "node:process";
import { extname } from "node:path";

const LINTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function run(command: string, args: string[]): CommandResult {
	const proc = Bun.spawnSync([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: proc.exitCode,
		stdout: new TextDecoder().decode(proc.stdout),
		stderr: new TextDecoder().decode(proc.stderr),
	};
}

function getTrackedChangedFiles(): string[] {
	const staged = run("git", ["diff", "--name-only", "--cached", "--diff-filter=ACMR"]);
	if (staged.exitCode !== 0) {
		throw new Error(staged.stderr.trim() || "Unable to list staged files.");
	}
	const stagedFiles = staged.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (stagedFiles.length > 0) {
		return stagedFiles;
	}
	const changed = run("git", ["diff", "--name-only", "--diff-filter=ACMR"]);
	if (changed.exitCode !== 0) {
		throw new Error(changed.stderr.trim() || "Unable to list changed files.");
	}
	return changed.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function isLintable(path: string): boolean {
	return LINTABLE_EXTENSIONS.has(extname(path).toLowerCase());
}

function printCommandOutput(output: string): void {
	const trimmed = output.trim();
	if (trimmed.length > 0) {
		console.log(trimmed);
	}
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

try {
	const candidateFiles = unique(getTrackedChangedFiles().filter(isLintable));
	if (candidateFiles.length === 0) {
		console.log("[lint-staged] No staged TS/JS files to lint; skipping.");
		process.exit(0);
	}

	console.log(`[lint-staged] Running Biome lint --write --unsafe on ${candidateFiles.length} file(s).`);
	const lintResult = run("bunx", ["@biomejs/biome", "lint", "--write", "--unsafe", ...candidateFiles]);
	printCommandOutput(lintResult.stdout);
	printCommandOutput(lintResult.stderr);
	if (lintResult.exitCode !== 0) {
		process.exit(lintResult.exitCode);
	}

	const addResult = run("git", ["add", "--", ...candidateFiles]);
	printCommandOutput(addResult.stdout);
	printCommandOutput(addResult.stderr);
	if (addResult.exitCode !== 0) {
		process.exit(addResult.exitCode);
	}

	console.log("[lint-staged] Lint fixes applied and files re-staged.");
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[lint-staged] ${message}`);
	process.exit(1);
}

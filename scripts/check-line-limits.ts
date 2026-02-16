import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const MAX_LINES = 400;

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const absolutePath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			walk(absolutePath, out);
			continue;
		}
		if (!entry.name.endsWith(".ts")) continue;
		out.push(absolutePath);
	}
	return out;
}

const files = walk("src");
const offenders: string[] = [];

for (const file of files) {
	const relPath = relative(process.cwd(), file);
	const contents = readFileSync(file, "utf8");
	const lineCount = contents.split(/\r?\n/).length;
	if (lineCount > MAX_LINES) {
		offenders.push(`${relPath}: ${lineCount}`);
	}
}

if (offenders.length > 0) {
	console.error(`[line-limit] Files exceed ${MAX_LINES} lines:`);
	for (const offender of offenders) {
		console.error(`  - ${offender}`);
	}
	process.exitCode = 1;
} else {
	console.log(`[line-limit] All TypeScript files under src are within ${MAX_LINES} lines.`);
}

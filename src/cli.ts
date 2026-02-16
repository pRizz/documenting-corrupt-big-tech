import { CliError } from "./utils";
import { runCapture } from "./capture";

const args = process.argv.slice(2);

try {
	await runCapture(args);
} catch (error) {
	if (error instanceof CliError) {
		console.error(`error: ${error.message}`);
		process.exit(1);
	}

	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

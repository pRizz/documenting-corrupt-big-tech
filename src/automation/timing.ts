import { CAPTURE_STEP_GAP_SEC, LOG_PREFIX, sleep } from "../utils";

export function logAction(message: string): void {
	console.log(`[${LOG_PREFIX}] ${message}`);
}

export async function sleepAfterAction(label: string, delaySec = CAPTURE_STEP_GAP_SEC): Promise<void> {
	if (delaySec <= 0) {
		logAction(`Skipping wait after ${label} because delay is ${delaySec}s`);
		return;
	}
	logAction(`Waiting ${delaySec}s after ${label}...`);
	await sleep(delaySec);
}

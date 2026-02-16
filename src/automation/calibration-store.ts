export function getCurrentTimeSuffix(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildSnapshotCalibrationPath(): string {
	return `./calibration/base-coordinates.snapshot-${getCurrentTimeSuffix()}.json`;
}

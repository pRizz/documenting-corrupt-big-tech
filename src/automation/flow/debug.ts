export async function runPrintWindow(automation: { printWindowMode: () => Promise<void> }): Promise<void> {
	await automation.printWindowMode();
}

export async function runCoordToRel(
	automation: { coordToRelMode: (x: number, y: number) => Promise<void> },
	x: number,
	y: number,
): Promise<void> {
	await automation.coordToRelMode(x, y);
}

export async function runPointCheck(
	automation: { pointCheckMode: (rx: number, ry: number) => Promise<void> },
	rx: number,
	ry: number,
): Promise<void> {
	await automation.pointCheckMode(rx, ry);
}


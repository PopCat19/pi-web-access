declare module "@earendil-works/pi-coding-agent" {
	export interface ExtensionAPI {
		on(event: string, handler: (...args: any[]) => any): void;
		registerTool(tool: any): void;
		registerCommand(name: string, command: any): void;
		exec(cmd: string, args: string[], opts?: { timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
	}
}

export function clientRuntimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function isolatedClientEnvironment(source: NodeJS.ProcessEnv, home: string, client: "codex" | "claude-code"): NodeJS.ProcessEnv;
export function prepareClientHome(environment: NodeJS.ProcessEnv): void;

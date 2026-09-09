export function clientRuntimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function isolatedClientEnvironment(source: NodeJS.ProcessEnv, home: string, client: "codex" | "claude-code"): NodeJS.ProcessEnv;
export function prepareClientHome(environment: NodeJS.ProcessEnv): void;
export function limitGitDiscoveryToWorkspace(environment: NodeJS.ProcessEnv, workspace: string): NodeJS.ProcessEnv;

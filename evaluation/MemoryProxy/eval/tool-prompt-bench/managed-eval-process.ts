import { spawn, execFile } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createServer } from "node:net";

export async function requireFreePort(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", () => reject(new Error("Proxy port is occupied: " + port)));
    server.listen(port, "127.0.0.1", () => server.close(() => done()));
  });
}
const owned = new Set<{ stop(): Promise<void> }>();
let stopping = false;
export function installManagedShutdown() {
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    stopping = true;
    void Promise.allSettled([...owned].map((child) => child.stop())).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
export function startManagedNode(options: { args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdout: string; stderr: string }) {
  if (stopping) throw new Error("Experiment is stopping");
  const stdout = openSync(options.stdout, "wx");
  let stderr: number;
  try { stderr = openSync(options.stderr, "wx"); } catch (error) { closeSync(stdout); throw error; }
  let child: ReturnType<typeof spawn>;
  try { child = spawn(process.execPath, options.args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ["ignore", stdout, stderr] }); }
  finally { closeSync(stdout); closeSync(stderr); }
  let exited = false;
  const done = new Promise<number>((resolve, reject) => {
    child.once("error", (error) => { exited = true; reject(error); });
    child.once("close", (code) => { exited = true; resolve(code ?? 1); });
  });
  // Long-running proxy failures must not become unhandled rejections while waiting for health.
  void done.catch(() => undefined);
  const handle = {
    pid: child.pid, done, get exited() { return exited; },
    async stop() {
      if (!exited && child.pid) {
        if (process.platform === "win32") {
          await new Promise<void>((resolve) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
        } else { child.kill("SIGTERM"); }
      }
      const timer = setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, 5000);
      try { await done; } catch { /* Start failures have already been reported by caller. */ } finally { clearTimeout(timer); }
    },
  };
  owned.add(handle);
  void done.then(() => owned.delete(handle), () => owned.delete(handle));
  return handle;
}
export async function waitManagedHealth(process: ReturnType<typeof startManagedNode>, url: string, profile: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let reason = "not listening";
  while (Date.now() < deadline) {
    if (process.exited) throw new Error("Proxy exited before ready; check its stderr log");
    try {
      const response = await fetch(url + "/health", { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const health = await response.json() as any;
        // A live incompatible binary must fail immediately, not burn the readiness timeout.
        if (health.toolPromptProfile !== profile) throw new Error("PROFILE:" + String(health.toolPromptProfile));
        return health;
      }
      reason = "HTTP " + response.status;
    } catch (error) { reason = String(error); if (reason.includes("PROFILE:")) throw new Error("Proxy profile mismatch: " + reason); }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Proxy readiness timed out: " + reason);
}

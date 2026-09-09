import { inspectFormalSmokeReadiness } from "./formal-smoke-readiness.js";

const report = await inspectFormalSmokeReadiness(process.cwd());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;

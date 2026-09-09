import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { TdaiGateway } from "../implementations/final/MemoryCore/src/gateway/server.js";

const runRoot = process.argv[2] && path.resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 8427);
if (!runRoot || !Number.isSafeInteger(port)) {
  throw new Error("Usage: start-final5-core.mjs <run-root> [port]");
}

const runtimeRoot = path.join(runRoot, "runtime-core");
const dataRoot = path.join(runtimeRoot, "data");
const identityPath = path.join(runtimeRoot, "identity.json");
const apiKey = process.env.E2E_API_KEY ?? "sdk-e2e-token";
fs.mkdirSync(dataRoot, { recursive: true });
process.env.TDAI_METADATA_SQLITE_BASE_DIR = path.join(dataRoot, "metadata");

function post(pathname, body) {
  const json = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(pathname, `http://127.0.0.1:${port}`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(json)),
        "x-tdai-service-id": "default",
        authorization: `Bearer ${apiKey}`,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) }); }
        catch { resolve({ status: response.statusCode ?? 0, body: raw }); }
      });
    });
    request.on("error", reject);
    request.end(json);
  });
}

const gateway = new TdaiGateway({
  server: { port, host: "127.0.0.1", apiKey },
  data: { baseDir: dataRoot },
  llm: { baseUrl: "http://localhost:1", apiKey: "unused", model: "unused" },
});

async function stop() {
  try { await gateway.stop(); } finally { process.exit(0); }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await gateway.start();
let identity;
if (fs.existsSync(identityPath)) {
  identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
} else {
  const receipt = await post("/v3/internal/meta/user/init-admin", {
    username: `final5-${Date.now().toString(36)}`,
  });
  if (receipt.status < 200 || receipt.status >= 300 || receipt.body?.code !== 0) {
    throw new Error(`Admin initialization failed: HTTP ${receipt.status}`);
  }
  const userKey = receipt.body.data?.user_key ?? receipt.body.data?.default_user_key;
  if (!userKey) throw new Error("Admin initialization returned no user key");
  identity = { receipt: receipt.body, serviceId: "default", userKey };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
}

console.log(JSON.stringify({ ready: true, port, dataRoot, identityPath }));
setInterval(() => {}, 1 << 30);

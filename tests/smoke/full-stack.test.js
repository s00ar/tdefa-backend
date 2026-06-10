import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const waitFor = async (check, timeoutMs = 30000) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw lastError ?? new Error("Timeout esperando el servicio");
};

const stopProcess = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await delay(500);
};

test(
  "smoke boot: the API starts from the repository root with seeded data",
  { timeout: 45000 },
  async () => {
    const apiPort = await getAvailablePort();
    const apiProcess = spawn("node", ["index.js"], {
      cwd: appRoot,
      env: {
        ...process.env,
        API_PORT: String(apiPort),
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_USER: "root",
        DB_PASSWORD: "",
        DB_NAME: "planilleros-app-smoke",
        DB_AUTO_CREATE: "true",
        DB_SEED: "true",
      },
      stdio: "ignore",
      shell: false,
    });

    try {
      const apiHealth = await waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
        if (!response.ok) throw new Error(`Health status ${response.status}`);
        return response.json();
      });

      const matches = await waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${apiPort}/api/matches`);
        if (!response.ok) throw new Error(`Matches status ${response.status}`);
        return response.json();
      });

      assert.equal(apiHealth.ok, true);
      assert.equal(apiHealth.matches, 10);
      assert.equal(matches.length, 10);
      assert.equal(matches[0].id, "m_3002");
    } finally {
      await stopProcess(apiProcess);
    }
  }
);

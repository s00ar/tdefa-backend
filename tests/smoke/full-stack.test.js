import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const appRoot = "D:\\Documents\\dev\\PIXVO.TECH\\TDEFA\\planilleros-app";

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
  "smoke full-stack: frontend y API arrancan con datos semilla listos para testear",
  { timeout: 45000 },
  async () => {
    const apiProcess = spawn("node", ["server/index.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      API_PORT: "3001",
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_USER: "root",
      DB_PASSWORD: "",
      DB_NAME: "planilleros-app-smoke",
    },
    stdio: "ignore",
    shell: false,
  });

    const previewProcess = spawn(
      "cmd.exe",
      ["/c", "npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"],
      {
        cwd: appRoot,
        env: { ...process.env },
        stdio: "ignore",
        shell: false,
      }
    );

    try {
      const apiHealth = await waitFor(async () => {
        const response = await fetch("http://127.0.0.1:3001/api/health");
        if (!response.ok) throw new Error(`Health status ${response.status}`);
        return response.json();
      });

      const frontendHtml = await waitFor(async () => {
        const response = await fetch("http://127.0.0.1:4173/");
        if (!response.ok) throw new Error(`Preview status ${response.status}`);
        return response.text();
      });

      assert.equal(apiHealth.ok, true);
      assert.equal(apiHealth.matches, 10);
      assert.match(frontendHtml, /<title>TDEFA Digital<\/title>/);
      assert.match(frontendHtml, /<div id="root"><\/div>/);
    } finally {
      await stopProcess(previewProcess);
      await stopProcess(apiProcess);
    }
  }
);

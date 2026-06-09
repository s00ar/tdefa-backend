import { once } from "node:events";
import { startServer } from "../../server/app.js";
import { closePool, resetDatabase } from "../../server/db.js";

export const TEST_DB_CONFIG = {
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "",
  database: "planilleros-app-test",
};

export const SMOKE_DB_CONFIG = {
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "",
  database: "planilleros-app-smoke",
};

export const resetTestDatabase = async (config = TEST_DB_CONFIG) => {
  await resetDatabase({ config });
};

export const startTestApiServer = async (config = TEST_DB_CONFIG) => {
  const { server, port } = await startServer({ port: 0, dbConfig: config });
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/api`,
    async close() {
      server.close();
      await once(server, "close");
      await closePool();
    },
  };
};

export const fetchJson = async (url, options) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
};

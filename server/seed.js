import { closePool, initializeDatabase, seedDatabase } from "./db.js";

try {
  const config = await initializeDatabase({ seed: false, createDatabase: true });
  await seedDatabase();
  console.log(`Seed sincronizado en ${config.database}`);
} catch (error) {
  console.error("No se pudo sincronizar el seed:", error);
  process.exitCode = 1;
} finally {
  await closePool();
}

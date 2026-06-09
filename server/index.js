import { startServer } from "./app.js";

startServer()
  .then(({ port, dbConfig }) => {
    console.log(
      `TDEFA API ready on http://localhost:${port}/api using MySQL ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`
    );
  })
  .catch((error) => {
    console.error("Could not start API:", error);
    process.exit(1);
  });

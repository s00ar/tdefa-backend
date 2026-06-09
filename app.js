import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { getPool, initializeDatabase, mapMatchRow, mapSheetRow } from "./db.js";

export const createApp = () => {
  const app = express();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(currentDir, "../public");
  const staticIndex = path.join(staticDir, "index.html");
  const hasStaticBundle = fs.existsSync(staticIndex);

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "1mb" }));

  const asyncHandler = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      res.status(500).json({ message });
    }
  };

  app.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      const pool = getPool();
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM matches");
      res.json({ ok: true, matches: total });
    })
  );

  app.get(
    "/api/planilleros",
    asyncHandler(async (_req, res) => {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT
          id,
          name,
          username,
          email,
          phone,
          dni,
          status,
          assigned_matches_count AS assignedMatchesCount,
          completed_matches_count AS completedMatchesCount,
          created_at_iso AS createdAtIso
        FROM planilleros
        ORDER BY created_at_iso DESC, name ASC`
      );
      res.json(rows);
    })
  );

  app.get(
    "/api/planilleros/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT
          id,
          name,
          username,
          email,
          phone,
          dni,
          status,
          assigned_matches_count AS assignedMatchesCount,
          completed_matches_count AS completedMatchesCount,
          created_at_iso AS createdAtIso
        FROM planilleros
        WHERE id = ?`,
        [req.params.id]
      );
      const item = rows[0];
      if (!item) {
        res.status(404).json({ message: "Planillero no encontrado" });
        return;
      }
      res.json(item);
    })
  );

  app.post(
    "/api/planilleros",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const body = req.body;
      const created = {
        id: `u_plan_${Date.now()}`,
        name: body.name,
        username: body.username,
        email: body.email ?? null,
        phone: body.phone ?? null,
        dni: body.dni ?? null,
        status: body.status ?? "activo",
        assignedMatchesCount: Number(body.assignedMatchesCount ?? 0),
        completedMatchesCount: Number(body.completedMatchesCount ?? 0),
        createdAtIso: new Date().toISOString().slice(0, 10),
      };

      await pool.execute(
        `INSERT INTO planilleros (
          id, name, username, email, phone, dni, status,
          assigned_matches_count, completed_matches_count, created_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          created.id,
          created.name,
          created.username,
          created.email,
          created.phone,
          created.dni,
          created.status,
          created.assignedMatchesCount,
          created.completedMatchesCount,
          created.createdAtIso,
        ]
      );

      res.status(201).json(created);
    })
  );

  app.patch(
    "/api/planilleros/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT
          id,
          name,
          username,
          email,
          phone,
          dni,
          status,
          assigned_matches_count AS assignedMatchesCount,
          completed_matches_count AS completedMatchesCount,
          created_at_iso AS createdAtIso
        FROM planilleros
        WHERE id = ?`,
        [req.params.id]
      );
      const current = rows[0];
      if (!current) {
        res.status(404).json({ message: "Planillero no encontrado" });
        return;
      }

      const updated = { ...current, ...req.body };
      await pool.execute(
        `UPDATE planilleros
        SET name = ?, username = ?, email = ?, phone = ?, dni = ?, status = ?,
            assigned_matches_count = ?, completed_matches_count = ?
        WHERE id = ?`,
        [
          updated.name,
          updated.username,
          updated.email,
          updated.phone,
          updated.dni,
          updated.status,
          updated.assignedMatchesCount,
          updated.completedMatchesCount,
          req.params.id,
        ]
      );
      res.json(updated);
    })
  );

  app.delete(
    "/api/planilleros/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      await pool.execute("DELETE FROM planilleros WHERE id = ?", [req.params.id]);
      res.status(204).send();
    })
  );

  app.get(
    "/api/matches",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const assignedPlanilleroId = req.query.assignedPlanilleroId;
      const query = assignedPlanilleroId
        ? `SELECT * FROM matches WHERE assigned_planillero_id = ? ORDER BY date_iso DESC, time DESC`
        : `SELECT * FROM matches ORDER BY date_iso DESC, time DESC`;
      const params = assignedPlanilleroId ? [assignedPlanilleroId] : [];
      const [rows] = await pool.execute(query, params);
      res.json(rows.map(mapMatchRow));
    })
  );

  app.get(
    "/api/matches/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM matches WHERE id = ?", [req.params.id]);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ message: "Partido no encontrado" });
        return;
      }
      res.json(mapMatchRow(row));
    })
  );

  app.patch(
    "/api/matches/:id/status",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      await pool.execute("UPDATE matches SET status = ?, reopen_reason = ? WHERE id = ?", [
        req.body.status,
        req.body.status === "reabierto" ? req.body.reopenReason ?? "Correccion manual" : null,
        req.params.id,
      ]);
      const [rows] = await pool.execute("SELECT * FROM matches WHERE id = ?", [req.params.id]);
      res.json(mapMatchRow(rows[0]));
    })
  );

  app.patch(
    "/api/matches/:id/score",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      await pool.execute("UPDATE matches SET score = ? WHERE id = ?", [
        JSON.stringify(req.body.score),
        req.params.id,
      ]);
      const [rows] = await pool.execute("SELECT * FROM matches WHERE id = ?", [req.params.id]);
      res.json(mapMatchRow(rows[0]));
    })
  );

  app.get(
    "/api/sheets/:matchId",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM sheets WHERE match_id = ?", [req.params.matchId]);
      const row = rows[0];
      if (!row) {
        const created = {
          matchId: req.params.matchId,
          homePlayers: [],
          awayPlayers: [],
          observations: "",
          incidents: [],
          updatedAtIso: new Date().toISOString(),
        };
        await pool.execute(
          `INSERT INTO sheets (match_id, home_players, away_players, observations, incidents, updated_at_iso)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            created.matchId,
            JSON.stringify(created.homePlayers),
            JSON.stringify(created.awayPlayers),
            created.observations,
            JSON.stringify(created.incidents),
            created.updatedAtIso,
          ]
        );
        res.json(created);
        return;
      }
      res.json(mapSheetRow(row));
    })
  );

  app.put(
    "/api/sheets/:matchId",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const payload = {
        matchId: req.params.matchId,
        homePlayers: req.body.homePlayers ?? [],
        awayPlayers: req.body.awayPlayers ?? [],
        observations: req.body.observations ?? "",
        incidents: req.body.incidents ?? [],
        updatedAtIso: new Date().toISOString(),
      };
      await pool.execute(
        `INSERT INTO sheets (match_id, home_players, away_players, observations, incidents, updated_at_iso)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           home_players = VALUES(home_players),
           away_players = VALUES(away_players),
           observations = VALUES(observations),
           incidents = VALUES(incidents),
           updated_at_iso = VALUES(updated_at_iso)`,
        [
          payload.matchId,
          JSON.stringify(payload.homePlayers),
          JSON.stringify(payload.awayPlayers),
          payload.observations,
          JSON.stringify(payload.incidents),
          payload.updatedAtIso,
        ]
      );
      res.json(payload);
    })
  );

  app.post(
    "/api/sheets/:matchId/incidents",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM sheets WHERE match_id = ?", [req.params.matchId]);
      const current = rows[0]
        ? mapSheetRow(rows[0])
        : {
            matchId: req.params.matchId,
            homePlayers: [],
            awayPlayers: [],
            observations: "",
            incidents: [],
            updatedAtIso: new Date().toISOString(),
          };
      const updated = {
        ...current,
        incidents: [{ id: `inc_${Date.now()}`, ...req.body }, ...current.incidents],
        updatedAtIso: new Date().toISOString(),
      };
      await pool.execute(
        `INSERT INTO sheets (match_id, home_players, away_players, observations, incidents, updated_at_iso)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           home_players = VALUES(home_players),
           away_players = VALUES(away_players),
           observations = VALUES(observations),
           incidents = VALUES(incidents),
           updated_at_iso = VALUES(updated_at_iso)`,
        [
          updated.matchId,
          JSON.stringify(updated.homePlayers),
          JSON.stringify(updated.awayPlayers),
          updated.observations,
          JSON.stringify(updated.incidents),
          updated.updatedAtIso,
        ]
      );
      res.status(201).json(updated);
    })
  );

  if (hasStaticBundle) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(staticIndex);
    });
  }

  return app;
};

export const startServer = async (options = {}) => {
  const port = Number(options.port ?? process.env.PORT ?? process.env.API_PORT ?? 3001);
  const dbConfig = await initializeDatabase({ config: options.dbConfig, seed: options.seed });
  const app = createApp();

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({ app, server, port: server.address().port, dbConfig });
    });
  });
};

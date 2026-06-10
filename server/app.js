import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import {
  getPool,
  initializeDatabase,
  mapMatchRow,
  mapSheetRow,
  mapTeamRow,
  mapTournamentRow,
} from "./db.js";

export const createApp = () => {
  const app = express();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(currentDir, "../public");
  const staticIndex = path.join(staticDir, "index.html");
  const hasStaticBundle = fs.existsSync(staticIndex);

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const requestId = req.get("X-Request-Id") || randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    console.info("[api] request", { requestId, method: req.method, path: req.originalUrl });
    res.on("finish", () => {
      console.info("[api] response", {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  const asyncHandler = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error("[api] handler error", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error?.code === "ER_DUP_ENTRY") {
        res.status(409).json({ message: "Ya existe un registro con esos datos" });
        return;
      }
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
      const name = String(body.name ?? "").trim();
      const username = String(body.username ?? "").trim();

      if (!name || !username) {
        res.status(400).json({ message: "Nombre y usuario son obligatorios" });
        return;
      }

      const created = {
        id: `u_plan_${randomUUID()}`,
        name,
        username,
        email: body.email ?? null,
        phone: body.phone ?? null,
        dni: body.dni ?? null,
        status: body.status === "inactivo" ? "inactivo" : "activo",
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

      console.info("[db] planillero created", {
        requestId: req.requestId,
        id: created.id,
        username: created.username,
      });
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
      if (!String(updated.name ?? "").trim() || !String(updated.username ?? "").trim()) {
        res.status(400).json({ message: "Nombre y usuario son obligatorios" });
        return;
      }

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
      console.info("[db] planillero updated", {
        requestId: req.requestId,
        id: req.params.id,
        username: updated.username,
      });
      res.json(updated);
    })
  );

  app.delete(
    "/api/planilleros/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [result] = await pool.execute("DELETE FROM planilleros WHERE id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ message: "Planillero no encontrado" });
        return;
      }
      console.info("[db] planillero deleted", {
        requestId: req.requestId,
        id: req.params.id,
      });
      res.status(204).send();
    })
  );

  app.get(
    "/api/tournaments",
    asyncHandler(async (_req, res) => {
      const pool = getPool();
      const [rows] = await pool.query(
        `SELECT t.*,
          (SELECT COUNT(*) FROM matches m WHERE m.tournament = t.name) AS matches_count
         FROM tournaments t
         ORDER BY t.status ASC, t.name ASC`
      );
      res.json(rows.map((row) => ({ ...mapTournamentRow(row), matchesCount: Number(row.matches_count) })));
    })
  );

  app.get(
    "/api/tournaments/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT t.*,
          (SELECT COUNT(*) FROM matches m WHERE m.tournament = t.name) AS matches_count
         FROM tournaments t WHERE t.id = ?`,
        [req.params.id]
      );
      if (!rows[0]) {
        res.status(404).json({ message: "Torneo no encontrado" });
        return;
      }
      res.json({ ...mapTournamentRow(rows[0]), matchesCount: Number(rows[0].matches_count) });
    })
  );

  app.post(
    "/api/tournaments",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const name = String(req.body.name ?? "").trim();
      if (!name) {
        res.status(400).json({ message: "El nombre del torneo es obligatorio" });
        return;
      }
      const created = {
        id: `tournament_${randomUUID()}`,
        name,
        season: String(req.body.season ?? "").trim() || null,
        status: req.body.status === "inactivo" ? "inactivo" : "activo",
        startDate: req.body.startDate || null,
        endDate: req.body.endDate || null,
        createdAtIso: new Date().toISOString(),
        matchesCount: 0,
      };
      if (created.startDate && created.endDate && created.startDate > created.endDate) {
        res.status(400).json({ message: "La fecha de inicio no puede ser posterior a la fecha de fin" });
        return;
      }
      await pool.execute(
        `INSERT INTO tournaments (id, name, season, status, start_date, end_date, created_at_iso)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          created.id,
          created.name,
          created.season,
          created.status,
          created.startDate,
          created.endDate,
          created.createdAtIso,
        ]
      );
      console.info("[db] tournament created", { requestId: req.requestId, id: created.id });
      res.status(201).json(created);
    })
  );

  app.patch(
    "/api/tournaments/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM tournaments WHERE id = ?", [req.params.id]);
      if (!rows[0]) {
        res.status(404).json({ message: "Torneo no encontrado" });
        return;
      }
      const current = mapTournamentRow(rows[0]);
      const updated = {
        ...current,
        ...req.body,
        name: String(req.body.name ?? current.name).trim(),
        season: String(req.body.season ?? current.season ?? "").trim() || null,
        status: req.body.status === "inactivo" ? "inactivo" : req.body.status === "activo" ? "activo" : current.status,
        startDate: req.body.startDate === undefined ? current.startDate : req.body.startDate || null,
        endDate: req.body.endDate === undefined ? current.endDate : req.body.endDate || null,
      };
      if (!updated.name) {
        res.status(400).json({ message: "El nombre del torneo es obligatorio" });
        return;
      }
      if (updated.startDate && updated.endDate && updated.startDate > updated.endDate) {
        res.status(400).json({ message: "La fecha de inicio no puede ser posterior a la fecha de fin" });
        return;
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `UPDATE tournaments SET name = ?, season = ?, status = ?, start_date = ?, end_date = ? WHERE id = ?`,
          [updated.name, updated.season, updated.status, updated.startDate, updated.endDate, req.params.id]
        );
        if (updated.name !== current.name) {
          await connection.execute("UPDATE matches SET tournament = ? WHERE tournament = ?", [
            updated.name,
            current.name,
          ]);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      const [[{ total }]] = await pool.execute("SELECT COUNT(*) AS total FROM matches WHERE tournament = ?", [
        updated.name,
      ]);
      console.info("[db] tournament updated", { requestId: req.requestId, id: req.params.id });
      res.json({ ...updated, matchesCount: Number(total) });
    })
  );

  app.delete(
    "/api/tournaments/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT name FROM tournaments WHERE id = ?", [req.params.id]);
      if (!rows[0]) {
        res.status(404).json({ message: "Torneo no encontrado" });
        return;
      }
      const [[{ total }]] = await pool.execute("SELECT COUNT(*) AS total FROM matches WHERE tournament = ?", [
        rows[0].name,
      ]);
      if (Number(total) > 0) {
        res.status(409).json({ message: "No se puede eliminar un torneo que tiene partidos asociados" });
        return;
      }
      await pool.execute("DELETE FROM tournaments WHERE id = ?", [req.params.id]);
      console.info("[db] tournament deleted", { requestId: req.requestId, id: req.params.id });
      res.status(204).send();
    })
  );

  app.get(
    "/api/teams",
    asyncHandler(async (_req, res) => {
      const pool = getPool();
      const [rows] = await pool.query("SELECT * FROM teams ORDER BY status ASC, name ASC");
      const items = [];
      for (const row of rows) {
        const [[{ total }]] = await pool.execute(
          `SELECT COUNT(*) AS total FROM matches
           WHERE JSON_UNQUOTE(JSON_EXTRACT(home_team, '$.id')) = ?
              OR JSON_UNQUOTE(JSON_EXTRACT(away_team, '$.id')) = ?`,
          [row.id, row.id]
        );
        items.push({ ...mapTeamRow(row), matchesCount: Number(total) });
      }
      res.json(items);
    })
  );

  app.get(
    "/api/teams/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM teams WHERE id = ?", [req.params.id]);
      if (!rows[0]) {
        res.status(404).json({ message: "Equipo no encontrado" });
        return;
      }
      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM matches
         WHERE JSON_UNQUOTE(JSON_EXTRACT(home_team, '$.id')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(away_team, '$.id')) = ?`,
        [req.params.id, req.params.id]
      );
      res.json({ ...mapTeamRow(rows[0]), matchesCount: Number(total) });
    })
  );

  app.post(
    "/api/teams",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const name = String(req.body.name ?? "").trim();
      const shortName = String(req.body.shortName ?? "").trim().toUpperCase();
      if (!name || !shortName) {
        res.status(400).json({ message: "Nombre y sigla del equipo son obligatorios" });
        return;
      }
      const created = {
        id: `team_${randomUUID()}`,
        name,
        shortName,
        city: String(req.body.city ?? "").trim() || null,
        status: req.body.status === "inactivo" ? "inactivo" : "activo",
        createdAtIso: new Date().toISOString(),
        matchesCount: 0,
      };
      await pool.execute(
        `INSERT INTO teams (id, name, short_name, city, status, created_at_iso)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [created.id, created.name, created.shortName, created.city, created.status, created.createdAtIso]
      );
      console.info("[db] team created", { requestId: req.requestId, id: created.id });
      res.status(201).json(created);
    })
  );

  app.patch(
    "/api/teams/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT * FROM teams WHERE id = ?", [req.params.id]);
      if (!rows[0]) {
        res.status(404).json({ message: "Equipo no encontrado" });
        return;
      }
      const current = mapTeamRow(rows[0]);
      const updated = {
        ...current,
        ...req.body,
        name: String(req.body.name ?? current.name).trim(),
        shortName: String(req.body.shortName ?? current.shortName).trim().toUpperCase(),
        city: String(req.body.city ?? current.city ?? "").trim() || null,
        status: req.body.status === "inactivo" ? "inactivo" : req.body.status === "activo" ? "activo" : current.status,
      };
      if (!updated.name || !updated.shortName) {
        res.status(400).json({ message: "Nombre y sigla del equipo son obligatorios" });
        return;
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "UPDATE teams SET name = ?, short_name = ?, city = ?, status = ? WHERE id = ?",
          [updated.name, updated.shortName, updated.city, updated.status, req.params.id]
        );
        await connection.execute(
          `UPDATE matches
           SET home_team = JSON_SET(home_team, '$.name', ?, '$.shortName', ?)
           WHERE JSON_UNQUOTE(JSON_EXTRACT(home_team, '$.id')) = ?`,
          [updated.name, updated.shortName, req.params.id]
        );
        await connection.execute(
          `UPDATE matches
           SET away_team = JSON_SET(away_team, '$.name', ?, '$.shortName', ?)
           WHERE JSON_UNQUOTE(JSON_EXTRACT(away_team, '$.id')) = ?`,
          [updated.name, updated.shortName, req.params.id]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM matches
         WHERE JSON_UNQUOTE(JSON_EXTRACT(home_team, '$.id')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(away_team, '$.id')) = ?`,
        [req.params.id, req.params.id]
      );
      console.info("[db] team updated", { requestId: req.requestId, id: req.params.id });
      res.json({ ...updated, matchesCount: Number(total) });
    })
  );

  app.delete(
    "/api/teams/:id",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const [rows] = await pool.execute("SELECT id FROM teams WHERE id = ?", [req.params.id]);
      if (!rows[0]) {
        res.status(404).json({ message: "Equipo no encontrado" });
        return;
      }
      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM matches
         WHERE JSON_UNQUOTE(JSON_EXTRACT(home_team, '$.id')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(away_team, '$.id')) = ?`,
        [req.params.id, req.params.id]
      );
      if (Number(total) > 0) {
        res.status(409).json({ message: "No se puede eliminar un equipo que tiene partidos asociados" });
        return;
      }
      await pool.execute("DELETE FROM teams WHERE id = ?", [req.params.id]);
      console.info("[db] team deleted", { requestId: req.requestId, id: req.params.id });
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

  app.post(
    "/api/matches",
    asyncHandler(async (req, res) => {
      const pool = getPool();
      const body = req.body;
      const requiredText = [
        "tournamentId",
        "homeTeamId",
        "awayTeamId",
        "dateIso",
        "time",
        "venue",
        "pitch",
        "assignedPlanilleroId",
      ];
      const missingField = requiredText.find((field) => !String(body[field] ?? "").trim());

      if (missingField) {
        res.status(400).json({ message: "Completá todos los datos obligatorios del partido" });
        return;
      }
      if (body.homeTeamId === body.awayTeamId) {
        res.status(400).json({ message: "El equipo local y visitante deben ser diferentes" });
        return;
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [planilleros] = await connection.execute(
          "SELECT id FROM planilleros WHERE id = ? AND status = 'activo'",
          [body.assignedPlanilleroId]
        );
        if (!planilleros[0]) {
          await connection.rollback();
          res.status(400).json({ message: "El planillero seleccionado no existe o está inactivo" });
          return;
        }
        const [tournaments] = await connection.execute(
          "SELECT id, name FROM tournaments WHERE id = ? AND status = 'activo'",
          [body.tournamentId]
        );
        const [homeTeams] = await connection.execute(
          "SELECT id, name, short_name FROM teams WHERE id = ? AND status = 'activo'",
          [body.homeTeamId]
        );
        const [awayTeams] = await connection.execute(
          "SELECT id, name, short_name FROM teams WHERE id = ? AND status = 'activo'",
          [body.awayTeamId]
        );
        if (!tournaments[0] || !homeTeams[0] || !awayTeams[0]) {
          await connection.rollback();
          res.status(400).json({ message: "El torneo o alguno de los equipos no existe o está inactivo" });
          return;
        }

        const created = {
          id: `m_${randomUUID()}`,
          tournament: tournaments[0].name,
          status: "pendiente",
          dateIso: String(body.dateIso).trim(),
          time: String(body.time).trim(),
          venue: String(body.venue).trim(),
          pitch: String(body.pitch).trim(),
          homeTeam: {
            id: homeTeams[0].id,
            name: homeTeams[0].name,
            shortName: homeTeams[0].short_name,
          },
          awayTeam: {
            id: awayTeams[0].id,
            name: awayTeams[0].name,
            shortName: awayTeams[0].short_name,
          },
          score: { home: 0, away: 0 },
          assignedPlanilleroId: String(body.assignedPlanilleroId),
          reopenReason: null,
        };

        await connection.execute(
          `INSERT INTO matches (
            id, tournament, status, date_iso, time, venue, pitch,
            home_team, away_team, score, assigned_planillero_id, reopen_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            created.id,
            created.tournament,
            created.status,
            created.dateIso,
            created.time,
            created.venue,
            created.pitch,
            JSON.stringify(created.homeTeam),
            JSON.stringify(created.awayTeam),
            JSON.stringify(created.score),
            created.assignedPlanilleroId,
            created.reopenReason,
          ]
        );
        await connection.execute(
          `INSERT INTO sheets (match_id, home_players, away_players, observations, incidents, updated_at_iso)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [created.id, "[]", "[]", "", "[]", new Date().toISOString()]
        );
        await connection.execute(
          `UPDATE planilleros
           SET assigned_matches_count = (
             SELECT COUNT(*) FROM matches WHERE assigned_planillero_id = ?
           )
           WHERE id = ?`,
          [created.assignedPlanilleroId, created.assignedPlanilleroId]
        );
        await connection.commit();

        console.info("[db] match created", {
          requestId: req.requestId,
          id: created.id,
          assignedPlanilleroId: created.assignedPlanilleroId,
        });
        res.status(201).json(created);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
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
      console.info("[db] sheet saved", {
        requestId: req.requestId,
        matchId: payload.matchId,
        incidents: payload.incidents.length,
      });
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
        incidents: [{ id: `inc_${randomUUID()}`, ...req.body }, ...current.incidents],
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
      console.info("[db] incident created", {
        requestId: req.requestId,
        matchId: updated.matchId,
        incidentId: updated.incidents[0].id,
      });
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

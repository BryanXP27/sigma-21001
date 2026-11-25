import { Request, Response, NextFunction } from "express";
import { AppError } from "./errors.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Errores de PostgreSQL (ej. unique violation 23505)
  if (typeof err === "object" && err !== null && "code" in err) {
    const pgErr = err as { code?: string; detail?: string; constraint?: string };
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Ya existe un registro con esos datos únicos." });
      return;
    }
    if (pgErr.code === "23503") {
      res.status(400).json({ error: "Violación de llave foránea: el registro referenciado no existe." });
      return;
    }
  }

  console.error("Error inesperado:", err);
  res.status(500).json({ error: "Ocurrió un error inesperado en el servidor." });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Endpoint no encontrado." });
}

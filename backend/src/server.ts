import "dotenv/config";
import cors from "cors";
import express from "express";
import apiRouter from "./api/index.js";
import { errorHandler, notFoundHandler } from "./core/middleware.js";
import { applyRuntimeMigrations } from "./core/migrations.js";
import { validateAuthConfiguration } from "./core/auth.js";

const app = express();
const port = Number(process.env.PORT ?? 3002);
const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173";

app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: "256kb" }));

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

validateAuthConfiguration();
void applyRuntimeMigrations()
  .then(() => {
    app.listen(port, "127.0.0.1", () => {
      console.log(`SIGMA 21001 API disponible en http://localhost:${port}`);
    });
  })
  .catch((error: unknown) => {
    console.error("No se pudieron aplicar las migraciones de base de datos:", error);
    process.exitCode = 1;
  });

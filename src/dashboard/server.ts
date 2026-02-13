import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "discord.js";
import { dashboardRouter } from "./routes";
import { logError, logSuccess } from "../utils/logger";
import { initSocketIO } from "./socketManager";

// ── Discord client reference (set after bot is ready) ────────────────
let _dashboardClient: Client | null = null;

export function setDashboardClient(client: Client): void {
    _dashboardClient = client;
}

export function getDashboardClient(): Client | null {
    return _dashboardClient;
}

// Resolve __dirname for ESM compatibility
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

export function createDashboard(): express.Application {
    const app = express();

    // ── View engine ──────────────────────────────────────────────────
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname2, "views"));

    // ── Middleware ────────────────────────────────────────────────────
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ── Static files ─────────────────────────────────────────────────
    app.use("/public", express.static(path.join(__dirname2, "..", "..", "public")));

    app.use(
        session({
            secret: process.env.DASHBOARD_SECRET || "itc-dashboard-secret-key",
            resave: false,
            saveUninitialized: false,
            store: MongoStore.create({
                mongoUrl: process.env.MONGO_URI || "mongodb://localhost:27017/itcb",
                collectionName: "dashboard_sessions",
                ttl: 7 * 24 * 60 * 60, // 7 days
            }),
            cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
        })
    );

    // ── Routes ───────────────────────────────────────────────────────
    app.use("/", dashboardRouter);

    // ── Error handler ────────────────────────────────────────────────
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        logError("Dashboard HTTP Error", err);
        res.status(500).send(`<pre style="color:red;">Dashboard Error:\n${err.stack || err.message || err}</pre>`);
    });

    return app;
}

export function startDashboard(port: number = 4000): void {
    const app = createDashboard();
    const server = http.createServer(app);

    // Attach Socket.IO to the HTTP server
    initSocketIO(server);

    server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
            logError("Dashboard Port In Use", `Port ${port} in use, trying ${port + 1}`);
            server.listen(port + 1, "0.0.0.0");
        } else {
            logError("Dashboard Server Error", err);
        }
    });

    server.on("listening", () => {
        const addr = server.address();
        const p = typeof addr === "object" ? addr?.port : port;
        logSuccess("Dashboard Running", `http://localhost:${p}`);
    });

    server.listen(port, "0.0.0.0");
}

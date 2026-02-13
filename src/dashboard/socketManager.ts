import { Server as SocketServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";

// ─── Singleton Socket.IO instance ────────────────────────────────────
let _io: SocketServer | null = null;

/**
 * Initialize Socket.IO on the existing HTTP server.
 * Call once from server.ts after creating the http server.
 */
export function initSocketIO(httpServer: HttpServer): SocketServer {
    _io = new SocketServer(httpServer, {
        cors: { origin: "*" },
        pingInterval: 25_000,
        pingTimeout: 20_000,
    });

    _io.on("connection", (socket: Socket) => {
        // Clients can join specific rooms for targeted updates
        socket.on("join:bot", (botTeamName: string) => {
            socket.join(`bot:${botTeamName}`);
        });

        socket.on("join:console", () => {
            socket.join("console");
        });

        socket.on("join:index", () => {
            socket.join("index");
        });
    });

    return _io;
}

/** Get the Socket.IO server instance (may be null if not initialized) */
export function getIO(): SocketServer | null {
    return _io;
}

// ─── Emit helpers ────────────────────────────────────────────────────

/** Bot voice status changed (joined/left/disconnected/reconnecting) */
export function emitBotStatus(teamName: string, data: {
    status: "connected" | "disconnected" | "reconnecting" | "error" | "deactivated" | "activated";
    detail?: string;
}): void {
    _io?.to(`bot:${teamName}`).emit("bot:status", { teamName, ...data });
    _io?.to("index").emit("bot:status", { teamName, ...data });
}

/** Bot data changed (config updated, workshop started/stopped, etc.) */
export function emitBotDataUpdate(teamName: string, data: {
    event: "workshop:started" | "workshop:stopped" | "config:updated" | "profile:updated";
    detail?: any;
}): void {
    _io?.to(`bot:${teamName}`).emit("bot:data", { teamName, ...data });
    _io?.to("index").emit("bot:data", { teamName, ...data });
}

/** New log entry for the web console */
export function emitLogEntry(entry: {
    level: string;
    title: string;
    body: string;
    timestamp: number;
}): void {
    _io?.to("console").emit("log:new", entry);
}

/** Bot added or deleted — refresh the index page */
export function emitBotListChange(): void {
    _io?.to("index").emit("bot:list-changed");
}

/** Session started */
export function emitSessionStarted(teamName: string, data: {
    workshopId: string;
    leaderID: string;
    type: string;
}): void {
    _io?.to(`bot:${teamName}`).emit("session:started", { teamName, ...data });
    _io?.to("index").emit("session:started", { teamName, ...data });
}

/** Session stopped */
export function emitSessionStopped(teamName: string, data: {
    workshopId: string;
    totalParticipants: number;
    totalDuration: number;
}): void {
    _io?.to(`bot:${teamName}`).emit("session:stopped", { teamName, ...data });
    _io?.to("index").emit("session:stopped", { teamName, ...data });
}

/** Leader role changed (added/removed roles) */
export function emitLeaderRoleChanged(teamName: string, data: {
    leaderId: string;
    added?: string[];
    removed?: string[];
}): void {
    _io?.to(`bot:${teamName}`).emit("leader:role-changed", { teamName, ...data });
}

/** Workshop reminder (30min before, at start time) */
export function emitWorkshopReminder(teamName: string, data: {
    workshopId: string;
    type: string;
    minutesUntilStart: number;
}): void {
    _io?.to(`bot:${teamName}`).emit("workshop:reminder", { teamName, ...data });
    _io?.to("index").emit("workshop:reminder", { teamName, ...data });
}

/** Participant joined voice during workshop */
export function emitParticipantJoined(teamName: string, data: {
    workshopId: string;
    userId: string;
    username: string;
}): void {
    _io?.to(`bot:${teamName}`).emit("participant:joined", { teamName, ...data });
}

/** Participant left voice during workshop */
export function emitParticipantLeft(teamName: string, data: {
    workshopId: string;
    userId: string;
    username: string;
}): void {
    _io?.to(`bot:${teamName}`).emit("participant:left", { teamName, ...data });
}

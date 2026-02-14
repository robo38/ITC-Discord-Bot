import { Server as SocketServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { executeCommand } from "../cli";

// ─── Singleton Socket.IO instance ────────────────────────────────────
let _io: SocketServer | null = null;

// ─── Online user tracking ────────────────────────────────────────────
interface OnlineUser {
    socketId: string;
    discordId: string;
    username: string;
    globalName: string;
    avatarUrl: string;
    role: string;
    currentPage: string;
    connectedAt: number;
}

const _onlineUsers = new Map<string, OnlineUser>();

// ─── Login log (in-memory ring buffer) ───────────────────────────────
interface LoginLogEntry {
    discordId: string;
    username: string;
    globalName: string;
    avatarUrl: string;
    role: string;
    timestamp: number;
}

const _loginLog: LoginLogEntry[] = [];
const LOGIN_LOG_MAX = 200;

export function addLoginLog(entry: Omit<LoginLogEntry, "timestamp">): void {
    _loginLog.unshift({ ...entry, timestamp: Date.now() });
    if (_loginLog.length > LOGIN_LOG_MAX) _loginLog.pop();
    _io?.to("dev").emit("dev:login", _loginLog[0]);
}

export function getLoginLog(): LoginLogEntry[] {
    return _loginLog;
}

export function getOnlineUsers(): OnlineUser[] {
    return Array.from(_onlineUsers.values());
}

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

        // ─── CLI command execution from web console ──────
        socket.on("cli:exec", async (command: string) => {
            try {
                const result = await executeCommand(command);
                socket.emit("cli:result", result);
            } catch (err: any) {
                socket.emit("cli:result", { output: `Error: ${err.message || err}`, clear: false });
            }
        });

        socket.on("join:index", () => {
            socket.join("index");
        });

        // ─── Dev room ───────────────────────────────────────
        socket.on("join:dev", () => {
            socket.join("dev");
        });

        // ─── Online user registration ───────────────────────
        socket.on("user:register", (data: {
            discordId: string;
            username: string;
            globalName: string;
            avatarUrl: string;
            role: string;
            currentPage: string;
        }) => {
            const user: OnlineUser = {
                socketId: socket.id,
                discordId: data.discordId,
                username: data.username,
                globalName: data.globalName,
                avatarUrl: data.avatarUrl,
                role: data.role,
                currentPage: data.currentPage || "/",
                connectedAt: Date.now(),
            };
            _onlineUsers.set(socket.id, user);
            _io?.to("dev").emit("dev:user-online", user);
            // Broadcast to all for leader online dots
            _io?.emit("global:user-online", { discordId: user.discordId });
        });

        // Page navigation tracking
        socket.on("user:navigate", (page: string) => {
            const user = _onlineUsers.get(socket.id);
            if (user) {
                user.currentPage = page;
                _io?.to("dev").emit("dev:user-navigate", { socketId: socket.id, page });
            }
        });

        // Dev requests online users list
        socket.on("dev:get-online-users", () => {
            socket.emit("dev:online-users", getOnlineUsers());
        });

        // Cleanup on disconnect
        socket.on("disconnect", () => {
            const user = _onlineUsers.get(socket.id);
            if (user) {
                _onlineUsers.delete(socket.id);
                _io?.to("dev").emit("dev:user-offline", { socketId: socket.id, discordId: user.discordId });
                // Broadcast to all for leader online dots
                // Only emit offline if no other socket has same discordId
                const stillOnline = Array.from(_onlineUsers.values()).some(u => u.discordId === user.discordId);
                if (!stillOnline) _io?.emit("global:user-offline", { discordId: user.discordId });
            }
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

/** Force-disconnect a user by discordId (kick from dashboard) */
export function kickUser(discordId: string): number {
    if (!_io) return 0;
    let kicked = 0;
    for (const [socketId, user] of _onlineUsers.entries()) {
        if (user.discordId === discordId) {
            const sock = _io.sockets.sockets.get(socketId);
            if (sock) {
                sock.emit("force-logout");
                sock.disconnect(true);
            }
            _onlineUsers.delete(socketId);
            kicked++;
        }
    }
    if (kicked > 0) {
        _io.to("dev").emit("dev:user-offline", { discordId });
        _io.emit("global:user-offline", { discordId });
    }
    return kicked;
}



import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { emitLogEntry } from "../dashboard/socketManager";

// ─── Channel IDs (DEV GUILD) ────────────────────────────────────────
const CHANNELS = {
    error:    "1441713440703123516",
    success:  "1441713461594685450",
    database: "1441713477331718166",
    debug:    "1441713509510414417",
} as const;

type LogLevel = keyof typeof CHANNELS;

const COLORS: Record<LogLevel, number> = {
    error:    0xff3b30,
    success:  0x34c759,
    database: 0x5856d6,
    debug:    0xff9500,
};

const ICONS: Record<LogLevel, string> = {
    error:    "❌",
    success:  "✅",
    database: "🗄️",
    debug:    "🔧",
};

// ─── In-memory ring buffer for web console (dev only) ────────────────
export interface WebLogEntry {
    level: LogLevel;
    title: string;
    body: string;
    timestamp: number; // ms since epoch
}

const MAX_WEB_LOGS = 500;
const _webLogs: WebLogEntry[] = [];

/** Get recent log entries for the web console (oldest first for streaming append) */
export function getWebLogs(limit: number = 200): WebLogEntry[] {
    return _webLogs.slice(-limit);
}

function _pushWebLog(level: LogLevel, title: string, body: string): void {
    const entry = { level, title, body, timestamp: Date.now() };
    _webLogs.push(entry);
    if (_webLogs.length > MAX_WEB_LOGS) _webLogs.splice(0, _webLogs.length - MAX_WEB_LOGS);
    // Push to connected Socket.IO console clients
    emitLogEntry(entry);
}

// ─── Rate limiting / deduplication for Discord sends ─────────────────
/** Per-channel send state */
interface ChannelSendState {
    /** Pending messages waiting to be batched */
    queue: { title: string; body: string; timestamp: Date }[];
    /** Timer for flush */
    timer: ReturnType<typeof setTimeout> | null;
    /** Last sent message key for dedup */
    lastKey: string;
    lastTime: number;
    dupCount: number;
}

const SEND_INTERVAL = 2_000;  // Batch sends every 2s per channel
const DEDUP_WINDOW = 30_000;   // Suppress identical messages within 30s
const MAX_BATCH = 5;           // Max messages per batch send

const _sendState: Record<string, ChannelSendState> = {};

function _getSendState(level: LogLevel): ChannelSendState {
    if (!_sendState[level]) {
        _sendState[level] = { queue: [], timer: null, lastKey: "", lastTime: 0, dupCount: 0 };
    }
    return _sendState[level];
}

// ─── State ───────────────────────────────────────────────────────────
let _client: Client | null = null;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || "";

/** Resolved channel references (set once on first use) */
const _channels: Partial<Record<LogLevel, TextChannel>> = {};

// Queue messages that arrive before the client is ready
const _queue: { level: LogLevel; title: string; body: string; timestamp: Date }[] = [];
let _ready = false;

// ─── Public API ──────────────────────────────────────────────────────

/** Call once after the bot is ready to enable Discord logging */
export function initLogger(client: Client): void {
    _client = client;
    _ready = true;
    // Flush queued messages
    for (const msg of _queue) {
        _enqueue(msg.level, msg.title, msg.body);
    }
    _queue.length = 0;
}

/** Log an error (console + Discord error channel + web buffer) */
export function logError(title: string, detail?: string | Error): void {
    const body = _fmt(detail);
    console.error(`[ERROR] ${title}${body ? `: ${body}` : ""}`);
    _pushWebLog("error", title, body);
    _enqueue("error", title, body);
}

/** Log a success event (console + Discord success channel + web buffer) */
export function logSuccess(title: string, detail?: string): void {
    console.log(`[SUCCESS] ${title}${detail ? `: ${detail}` : ""}`);
    _pushWebLog("success", title, detail ?? "");
    _enqueue("success", title, detail ?? "");
}

/** Log a database event (console + Discord database channel + web buffer) */
export function logDatabase(title: string, detail?: string): void {
    console.log(`[DATABASE] ${title}${detail ? `: ${detail}` : ""}`);
    _pushWebLog("database", title, detail ?? "");
    _enqueue("database", title, detail ?? "");
}

/** Log a debug message (console + Discord debug channel + web buffer) */
export function logDebug(title: string, detail?: string): void {
    console.log(`[DEBUG] ${title}${detail ? `: ${detail}` : ""}`);
    _pushWebLog("debug", title, detail ?? "");
    _enqueue("debug", title, detail ?? "");
}

// ─── Internals ───────────────────────────────────────────────────────

function _fmt(detail?: string | Error): string {
    if (!detail) return "";
    if (detail instanceof Error) return detail.stack ?? detail.message;
    return detail;
}

function _enqueue(level: LogLevel, title: string, body: string): void {
    if (!_ready) {
        _queue.push({ level, title, body, timestamp: new Date() });
        return;
    }

    const state = _getSendState(level);
    const now = Date.now();
    const key = `${title}::${body.slice(0, 100)}`;

    // Dedup: if same message within window, suppress and count
    if (key === state.lastKey && now - state.lastTime < DEDUP_WINDOW) {
        state.dupCount++;
        return;
    }

    // If we had suppressed duplicates, add a summary message
    if (state.dupCount > 0) {
        state.queue.push({
            title: `⚠️ Suppressed ${state.dupCount} duplicate(s)`,
            body: `Last: ${state.lastKey.split("::")[0]}`,
            timestamp: new Date(),
        });
    }

    state.lastKey = key;
    state.lastTime = now;
    state.dupCount = 0;

    state.queue.push({ title, body, timestamp: new Date() });

    // Start flush timer if not already running
    if (!state.timer) {
        state.timer = setTimeout(() => _flushChannel(level), SEND_INTERVAL);
    }
}

async function _flushChannel(level: LogLevel): Promise<void> {
    const state = _getSendState(level);
    state.timer = null;

    if (state.queue.length === 0) return;

    // Take up to MAX_BATCH messages
    const batch = state.queue.splice(0, MAX_BATCH);

    // If there are still messages remaining, schedule next flush
    if (state.queue.length > 0) {
        state.timer = setTimeout(() => _flushChannel(level), SEND_INTERVAL);
    }

    // Send batch as embeds (Discord allows up to 10 embeds per message)
    try {
        const channel = await _getChannel(level);
        if (!channel) return;

        const embeds = batch.map(msg => {
            const description = msg.body.length > 4000
                ? msg.body.slice(0, 4000) + "\n…(truncated)"
                : msg.body;

            const embed = new EmbedBuilder()
                .setTitle(`${ICONS[level]}  ${msg.title}`.slice(0, 256))
                .setColor(COLORS[level])
                .setTimestamp(msg.timestamp);

            if (description) {
                embed.setDescription("```\n" + description + "\n```");
            }

            return embed;
        });

        await channel.send({ embeds });
    } catch {
        // Silently fail — don't log logging errors to avoid loops
    }
}

async function _getChannel(level: LogLevel): Promise<TextChannel | null> {
    if (!_client || !DEV_GUILD_ID) return null;

    let channel = _channels[level];
    if (!channel) {
        try {
            const guild = _client.guilds.cache.get(DEV_GUILD_ID);
            if (!guild) return null;
            const fetched = await guild.channels.fetch(CHANNELS[level]).catch(() => null);
            if (!fetched || !fetched.isTextBased()) return null;
            channel = fetched as TextChannel;
            _channels[level] = channel;
        } catch {
            return null;
        }
    }
    return channel;
}

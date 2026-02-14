/**
 * Interactive CLI for controlling the bot from the console.
 * Provides commands for bot management, whitelist control, user actions, and workshops.
 * Also exposes executeCommand() for the web console.
 */

import { Client } from "discord.js";
import { createInterface, Interface } from "readline";
import { logSuccess, logError, logDebug } from "./utils/logger";
import {
    disconnectVoiceBot,
    reconnectVoiceBot,
    deactivateVoiceBot,
    activateVoiceBot,
    getAllVoiceBots,
} from "./voice";
import { stopWorkshop, stopWorkshopByLeader } from "./workshop";
import { Whitelist } from "./database/models/Whitelist";
import { BotConfig } from "./database/models/BotConfig";
import { Workshop } from "./database";
import { kickUser, getOnlineUsers } from "./dashboard/socketManager";

let mainClient: Client | null = null;
let rl: Interface | null = null;

/** Collects output lines during a web command execution */
let _outputLines: string[] = [];
let _isWebExec = false;

/** Capture-aware print: writes to _outputLines when executing for web, else console.log */
function print(msg: string = "") {
    if (_isWebExec) {
        _outputLines.push(msg);
    } else {
        console.log(msg);
    }
}

const HELP_TEXT = `
  ╔══════════════════════════════════════════════════════════╗
  ║                   ITC Bot CLI — Commands                 ║
  ╠══════════════════════════════════════════════════════════╣
  ║  help                    Show this help menu             ║
  ║  status                  Show all voice bots status      ║
  ║  online                  Show online dashboard users     ║
  ║                                                          ║
  ║  ── Bot Control ─────────────────────────────────────── ║
  ║  disconnect <team>       Disconnect a voice bot          ║
  ║  reconnect <team>        Reconnect a voice bot           ║
  ║  deactivate <team>       Deactivate a voice bot          ║
  ║  activate <team>         Activate a voice bot            ║
  ║  bots                    List all configured bots        ║
  ║                                                          ║
  ║  ── Workshop ────────────────────────────────────────── ║
  ║  stop-ws <workshopId>    Stop a workshop by ID           ║
  ║  workshops               List active workshops           ║
  ║                                                          ║
  ║  ── Whitelist ───────────────────────────────────────── ║
  ║  wl-add <discordId>      Add user to whitelist           ║
  ║  wl-remove <discordId>   Remove user from whitelist      ║
  ║  wl-list                 List all whitelisted users      ║
  ║                                                          ║
  ║  ── Users ───────────────────────────────────────────── ║
  ║  kick <discordId>        Kick user from dashboard        ║
  ║                                                          ║
  ║  ── System ──────────────────────────────────────────── ║
  ║  clear                   Clear the console               ║
  ║  exit                    Stop the bot and exit           ║
  ╚══════════════════════════════════════════════════════════╝
`;

// ─── Command handlers ────────────────────────────────────────────────

async function cmdHelp() {
    print(HELP_TEXT);
}

async function cmdStatus() {
    const bots = getAllVoiceBots();
    if (bots.size === 0) {
        print("  No voice bots registered.");
        return;
    }
    print(`\n  Voice Bots (${bots.size}):`);
    print("  " + "─".repeat(52));
    for (const [name, bot] of bots) {
        const status = bot.disconnected
            ? (_isWebExec ? "Disconnected" : "\x1b[31mDisconnected\x1b[0m")
            : bot.connection
            ? (_isWebExec ? "Connected" : "\x1b[32mConnected\x1b[0m")
            : (_isWebExec ? "No connection" : "\x1b[33mNo connection\x1b[0m");
        print(`  ${name.padEnd(28)} ${status}`);
    }
    print();
}

async function cmdOnline() {
    const users = getOnlineUsers();
    if (users.length === 0) {
        print("  No users online on the dashboard.");
        return;
    }
    print(`\n  Online Dashboard Users (${users.length}):`);
    print("  " + "─".repeat(52));
    for (const u of users) {
        print(`  ${(u.globalName || u.username || "").padEnd(24)} ${u.discordId}  [${u.role}]  ${u.currentPage || ""}`);
    }
    print();
}

async function cmdDisconnect(teamName: string) {
    if (!teamName) { print("  Usage: disconnect <team>"); return; }
    const ok = disconnectVoiceBot(teamName);
    print(ok ? `  Disconnected: ${teamName}` : `  Failed — bot not found: ${teamName}`);
}

async function cmdReconnect(teamName: string) {
    if (!teamName) { print("  Usage: reconnect <team>"); return; }
    const ok = reconnectVoiceBot(teamName);
    print(ok ? `  Reconnecting: ${teamName}` : `  Failed — bot not found: ${teamName}`);
}

async function cmdDeactivate(teamName: string) {
    if (!teamName) { print("  Usage: deactivate <team>"); return; }
    const ok = await deactivateVoiceBot(teamName);
    print(ok ? `  Deactivated: ${teamName}` : `  Failed — bot not found: ${teamName}`);
}

async function cmdActivate(teamName: string) {
    if (!teamName) { print("  Usage: activate <team>"); return; }
    const ok = await activateVoiceBot(teamName);
    print(ok ? `  Activated: ${teamName}` : `  Failed — bot not found: ${teamName}`);
}

async function cmdBots() {
    const bots = await BotConfig.find().lean();
    if (bots.length === 0) { print("  No bots configured."); return; }
    print(`\n  Configured Bots (${bots.length}):`);
    print("  " + "─".repeat(52));
    for (const b of bots) {
        const active = b.isActive
            ? (_isWebExec ? "Active" : "\x1b[32mActive\x1b[0m")
            : (_isWebExec ? "Inactive" : "\x1b[31mInactive\x1b[0m");
        const split = b.isSplit ? " [Split]" : "";
        print(`  ${(b.teamName || "").padEnd(24)} ${active}${split}`);
    }
    print();
}

async function cmdStopWorkshop(wsId: string) {
    if (!wsId) { print("  Usage: stop-ws <workshopId>"); return; }
    if (!mainClient) { print("  Main client not ready."); return; }
    const result = await stopWorkshop(wsId, mainClient);
    print(`  ${result.success ? "Stopped" : "Failed"}: ${result.message}`);
}

async function cmdWorkshops() {
    const active = await Workshop.find({ status: { $in: ["active", "scheduled"] } }).lean();
    if (active.length === 0) { print("  No active or scheduled workshops."); return; }
    print(`\n  Active/Scheduled Workshops (${active.length}):`);
    print("  " + "─".repeat(64));
    for (const w of active) {
        const start = new Date(w.startTime).toLocaleString();
        print(`  ${(w.teamName || "").padEnd(22)} ${w.status.padEnd(12)} ${w.workshopId.substring(0, 16)}...  ${start}`);
    }
    print();
}

async function cmdWlAdd(discordId: string) {
    if (!discordId) { print("  Usage: wl-add <discordId>"); return; }
    const exists = await Whitelist.findOne({ discordId });
    if (exists) { print(`  Already whitelisted: ${discordId}`); return; }
    await Whitelist.create({ discordId, addedBy: "cli" });
    print(`  Added to whitelist: ${discordId}`);
}

async function cmdWlRemove(discordId: string) {
    if (!discordId) { print("  Usage: wl-remove <discordId>"); return; }
    const res = await Whitelist.deleteOne({ discordId });
    print(res.deletedCount ? `  Removed from whitelist: ${discordId}` : `  Not found: ${discordId}`);
}

async function cmdWlList() {
    const entries = await Whitelist.find().lean();
    if (entries.length === 0) { print("  Whitelist is empty."); return; }
    print(`\n  Whitelisted Users (${entries.length}):`);
    print("  " + "─".repeat(40));
    for (const e of entries) {
        print(`  ${e.discordId}  (added by: ${(e as any).addedBy || "unknown"})`);
    }
    print();
}

async function cmdKick(discordId: string) {
    if (!discordId) { print("  Usage: kick <discordId>"); return; }
    const kicked = kickUser(discordId);
    print(kicked ? `  Kicked: ${discordId}` : `  User not online: ${discordId}`);
}

async function cmdClear() {
    if (_isWebExec) {
        print("__CLEAR__");
    } else {
        console.clear();
    }
}

async function cmdExit() {
    if (_isWebExec) {
        print("  Exit command is only available from the server terminal.");
        return;
    }
    console.log("  Shutting down...");
    process.exit(0);
}

// ─── Command registry ────────────────────────────────────────────────

const COMMANDS: Record<string, (arg: string) => Promise<void>> = {
    help: cmdHelp,
    status: cmdStatus,
    online: cmdOnline,
    disconnect: cmdDisconnect,
    reconnect: cmdReconnect,
    deactivate: cmdDeactivate,
    activate: cmdActivate,
    bots: cmdBots,
    "stop-ws": cmdStopWorkshop,
    workshops: cmdWorkshops,
    "wl-add": cmdWlAdd,
    "wl-remove": cmdWlRemove,
    "wl-list": cmdWlList,
    kick: cmdKick,
    clear: cmdClear,
    exit: cmdExit,
};

// ─── Process input ───────────────────────────────────────────────────

async function processCommand(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    const spaceIndex = trimmed.indexOf(" ");
    const cmd = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.substring(0, spaceIndex).toLowerCase();
    const arg = spaceIndex === -1 ? "" : trimmed.substring(spaceIndex + 1).trim();

    const handler = COMMANDS[cmd];
    if (!handler) {
        print(`  Unknown command: ${cmd}. Type "help" for available commands.`);
        return;
    }

    try {
        await handler(arg);
    } catch (err: any) {
        print(`  Error executing "${cmd}": ${err.message || err}`);
    }
}

// ─── Execute command (for web console) ───────────────────────────────

/**
 * Execute a CLI command and return the output as a string.
 * Used by the web console to run commands from the browser.
 */
export async function executeCommand(line: string): Promise<{ output: string; clear?: boolean }> {
    _isWebExec = true;
    _outputLines = [];
    await processCommand(line);
    _isWebExec = false;
    const output = _outputLines.join("\n");
    const clear = output.includes("__CLEAR__");
    return { output: clear ? "" : output, clear };
}

// ─── Start CLI ───────────────────────────────────────────────────────

export function startCLI(client: Client): void {
    mainClient = client;

    rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "\x1b[31mITC\x1b[0m > ",
        terminal: true,
    });

    // Show welcome
    console.log();
    console.log("  \x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
    console.log("  \x1b[1m  ITC Bot CLI — Interactive Console\x1b[0m");
    console.log("  \x1b[2m  Type \"help\" for available commands\x1b[0m");
    console.log("  \x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
    console.log();

    rl.prompt();

    rl.on("line", async (line) => {
        await processCommand(line);
        rl?.prompt();
    });

    rl.on("close", () => {
        console.log("\n  CLI closed.");
    });
}

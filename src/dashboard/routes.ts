import { Router, Request, Response } from "express";
import { BotConfig } from "../database/models/BotConfig";
import { Workshop } from "../database/models/Workshop";
import { Participant } from "../database/models/Participant";
import { Session } from "../database/models/Session";
import { Whitelist } from "../database/models/Whitelist";
import { requireAuth, AuthRequest, DashboardUser } from "./auth";
import { getOAuthUrl, exchangeCode, getOAuthUser, avatarUrl } from "./discord";
import { getDashboardClient } from "./server";
import { logError, logSuccess, logDebug, getWebLogs } from "../utils/logger";
import { exportWorkshopToExcel } from "../workshop/excelExport";
import {
    disconnectVoiceBot,
    reconnectVoiceBot,
    deactivateVoiceBot,
    activateVoiceBot,
    updateBotProfile,
    loginSingleVoiceBot,
    getVoiceBot,
} from "../voice";
import { createWorkshop, stopWorkshop } from "../workshop";
import { botConfigToTeamConfigs } from "./loadConfigs";
import { emitBotDataUpdate, emitBotListChange, emitBotStatus, addLoginLog, getLoginLog, getOnlineUsers, kickUser } from "./socketManager";
import { resolveMeta } from "./metaData";

export const dashboardRouter = Router();

// ─── Live duration helpers ───────────────────────────────────────────
// For sessions still in progress (no leaveTime/mutedAt/undeafenedAt),
// compute elapsed time from the start timestamp instead of using the
// stored duration (which is 0 until the session closes).
function liveVoiceMs(sessions: any[]): number {
    const now = Date.now();
    return sessions.reduce((sum: number, s: any) => {
        if (s.leaveTime) return sum + s.duration;
        return sum + (now - new Date(s.joinTime).getTime());
    }, 0);
}

function liveMicMs(activity: any[]): number {
    const now = Date.now();
    return activity.reduce((sum: number, m: any) => {
        if (m.mutedAt) return sum + m.duration;
        return sum + (now - new Date(m.unmutedAt).getTime());
    }, 0);
}

function liveDeafenMs(activity: any[]): number {
    const now = Date.now();
    return activity.reduce((sum: number, d: any) => {
        if (d.undeafenedAt) return sum + d.duration;
        return sum + (now - new Date(d.deafenedAt).getTime());
    }, 0);
}

const DEV_USER_ID = process.env.DEV_USER_ID || "";
const BE_ID = process.env.BE_ID || "";
const ADMIN_ID = process.env.ADMIN_ID || "";
const GUILD_ID = process.env.GUILD_ID || "";

// Middleware: set res.locals.hasDevAccess for every authenticated request
dashboardRouter.use(async (req: AuthRequest, res: Response, next) => {
    const sessionUser = (req.session as any)?.user as DashboardUser | undefined;
    if (sessionUser) {
        res.locals.hasDevAccess = await hasDevAccess(sessionUser);
    }
    next();
});

/** Check if user has dev-panel access (dev role OR whitelisted) */
async function hasDevAccess(user: DashboardUser): Promise<boolean> {
    if (user.role === "dev") return true;
    const wl = await Whitelist.findOne({ discordId: user.discordId }).lean();
    return !!wl;
}

/** Check if user is the actual dev (not just whitelisted) */
function isDevOwner(user: DashboardUser): boolean {
    return user.role === "dev";
}

function getRedirectUri(req: Request): string {
    const base = (process.env.DASHBOARD_URL || `${req.protocol}://${req.get("host")}`).trim();
    return `${base}/auth/callback`;
}

/** Get leaders for a role from the Discord.js client cache */
function getLeadersFromCache(leaderRoleId: string): { id: string; username: string; globalName: string; avatarUrl: string; roles: string[]; roleIds: string[] }[] {
    const client = getDashboardClient();
    if (!client || !leaderRoleId || !GUILD_ID) return [];
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return [];
        const role = guild.roles.cache.get(leaderRoleId);
        if (!role) return [];
        return Array.from(role.members.values()).map(m => ({
            id: m.id,
            username: m.user.username,
            globalName: m.displayName,
            avatarUrl: m.user.displayAvatarURL({ size: 64, extension: "png" }),
            roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name),
            roleIds: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.id),
        }));
    } catch {
        return [];
    }
}

/** Resolve a role ID to its name using the Discord cache */
function resolveRoleName(roleId: string): string {
    if (!roleId) return "—";
    const client = getDashboardClient();
    if (!client || !GUILD_ID) return roleId;
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return roleId;
        const role = guild.roles.cache.get(roleId);
        return role?.name || roleId;
    } catch {
        return roleId;
    }
}

/** Resolve a channel ID to its name using the Discord cache */
function resolveChannelName(channelId: string): string {
    if (!channelId) return "—";
    const client = getDashboardClient();
    if (!client || !GUILD_ID) return channelId;
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return channelId;
        const channel = guild.channels.cache.get(channelId);
        return channel?.name ? `#${channel.name}` : channelId;
    } catch {
        return channelId;
    }
}

// ─── Login ───────────────────────────────────────────────────────────
dashboardRouter.get("/login", (req: Request, res: Response) => {
    res.render("login", { oauthUrl: getOAuthUrl(getRedirectUri(req)), error: null, meta: resolveMeta("login") });
});

// ─── OAuth2 Callback ─────────────────────────────────────────────────
dashboardRouter.get("/auth/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const redirectUri = getRedirectUri(req);

    if (!code) {
        res.render("login", { oauthUrl: getOAuthUrl(redirectUri), error: "No authorization code received.", meta: resolveMeta("login") });
        return;
    }

    try {
        const accessToken = await exchangeCode(code, redirectUri);
        const discordUser = await getOAuthUser(accessToken);

        // Get guild member roles & permissions via bot client cache
        let userRoleIds: string[] = [];
        const client = getDashboardClient();
        if (client && GUILD_ID) {
            try {
                const guild = client.guilds.cache.get(GUILD_ID);
                if (guild) {
                    const member = await guild.members.fetch(discordUser.id);
                    userRoleIds = member.roles.cache.map(r => r.id);
                    logDebug("Dashboard Login", `${discordUser.username} roles=[${userRoleIds.length}]`);
                } else {
                    logDebug("Dashboard Login", `Guild ${GUILD_ID} not in cache`);
                }
            } catch (e: any) {
                logError("Dashboard Member Fetch", `Could not fetch ${discordUser.id}: ${e.message}`);
            }
        } else {
            logDebug("Dashboard Login", `No client or GUILD_ID`);
        }

        // Determine dashboard role
        // Priority: DEV > ADMIN > BE > LEADER
        let role: "dev" | "be" | "admin" | "leader";
        let leaderTeamIds: string[] = [];

        if (discordUser.id === DEV_USER_ID) {
            role = "dev";
        } else if (ADMIN_ID && userRoleIds.includes(ADMIN_ID)) {
            role = "admin";
        } else if (BE_ID && userRoleIds.includes(BE_ID)) {
            role = "be";
        } else {
            // Check leader roles against BotConfig
            const allConfigs = await BotConfig.find({ isActive: true }).lean();
            for (const cfg of allConfigs) {
                if (cfg.leaderRoleId && userRoleIds.includes(cfg.leaderRoleId)) {
                    leaderTeamIds.push((cfg as any)._id.toString());
                }
            }
            if (leaderTeamIds.length > 0) {
                role = "leader";
                logDebug("Dashboard Login", `${discordUser.username} matched as leader for teams: [${leaderTeamIds.join(", ")}]`);
            } else {
                logDebug("Dashboard Login", `${discordUser.username} (${discordUser.id}) denied — no leader match. User roles: [${userRoleIds.join(", ")}]. Config leader roles: [${allConfigs.map(c => c.leaderRoleId).filter(Boolean).join(", ")}]`);
                res.render("login", {
                    oauthUrl: getOAuthUrl(redirectUri),
                    error: "Access denied. You need BE role, Admin permission, or a team leader role.",
                    meta: resolveMeta("login"),
                });
                return;
            }
        }

        const sessionUser: DashboardUser = {
            discordId: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name || discordUser.username,
            avatarUrl: avatarUrl(discordUser, 128),
            role,
            leaderTeamIds,
        };
        (req.session as any).user = sessionUser;

        // Log the login event for dev panel
        addLoginLog({
            discordId: sessionUser.discordId,
            username: sessionUser.username,
            globalName: sessionUser.globalName,
            avatarUrl: sessionUser.avatarUrl,
            role: sessionUser.role,
        });
        logSuccess("Dashboard Login", `${sessionUser.globalName} (${sessionUser.role}) logged in`);

        res.redirect("/");
    } catch (err: any) {
        logError("Dashboard OAuth", err);
        res.render("login", {
            oauthUrl: getOAuthUrl(redirectUri),
            error: err.message || "Login failed. Please try again.",
            meta: resolveMeta("login"),
        });
    }
});

dashboardRouter.get("/logout", (req: Request, res: Response) => {
    req.session.destroy(() => res.redirect("/login"));
});

// ─── Home (list bots) ───────────────────────────────────────────────
dashboardRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
    const user = req.user!;

    // Leaders with a single team go straight to their team page
    if (user.role === "leader" && user.leaderTeamIds.length === 1) {
        res.redirect(`/bots/${user.leaderTeamIds[0]}`);
        return;
    }

    let bots: any[];

    if (user.role === "leader") {
        bots = await BotConfig.find({ _id: { $in: user.leaderTeamIds } }).lean();
    } else {
        bots = await BotConfig.find().sort({ teamName: 1 }).lean();
    }

    // Check active workshops for glow indicator
    const activeWorkshopTeams = new Set<string>();
    const activeWsList = await Workshop.find({ status: "active" }, { teamName: 1 }).lean();
    for (const ws of activeWsList) activeWorkshopTeams.add(ws.teamName);

    // Attach leaders from Discord cache
    const botsWithLeaders = bots.map(bot => {
        // For split bots, check both expanded team names
        const hasActiveWorkshop = bot.isSplit
            ? activeWorkshopTeams.has(`${bot.teamName} (Beginner)`) || activeWorkshopTeams.has(`${bot.teamName} (Advanced)`)
            : activeWorkshopTeams.has(bot.teamName);
        return {
            ...bot,
            leaders: getLeadersFromCache(bot.leaderRoleId),
            leaderRoleName: resolveRoleName(bot.leaderRoleId),
            membersRoleName: resolveRoleName(bot.membersRoleId),
            hasActiveWorkshop,
        };
    });

    res.render("index", { bots: botsWithLeaders, user, meta: resolveMeta("index") });
});

// ─── Add bot ─────────────────────────────────────────────────────────
dashboardRouter.get("/bots/add", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }
    res.render("addBot", { user: req.user, error: null, meta: resolveMeta("addBot") });
});

dashboardRouter.post("/bots/add", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }

    try {
        const {
            teamName, leaderRoleId, membersRoleId, additionalMembersRoleId,
            isSplit, botToken, botId, voiceChannelId,
            botToken1, botToken2, voiceChannelId1, voiceChannelId2, specialRoleId,
            leaderChatChannelId, generalAnnChannelId,
        } = req.body;

        const splitBool = isSplit === "true" || isSplit === "on";
        const configData: any = {
            teamName,
            leaderRoleId: leaderRoleId || "",
            membersRoleId: membersRoleId || "",
            additionalMembersRoleId: additionalMembersRoleId || "",
            isSplit: splitBool,
            leaderChatChannelId: leaderChatChannelId || "",
            generalAnnChannelId: generalAnnChannelId || "",
            isActive: true,
        };

        if (splitBool) {
            configData.splitConfig = { botToken1, botToken2, voiceChannelId1, voiceChannelId2, specialRoleId: specialRoleId || "" };
        } else {
            configData.botToken = botToken || "";
            configData.botId = botId || "";
            configData.voiceChannelId = voiceChannelId || "";
        }

        await BotConfig.create(configData);
        logSuccess("Dashboard", `Bot "${teamName}" created by ${req.user!.username}`);
        emitBotListChange();

        // Auto-connect: login the new bot and join its voice channel
        try {
            const newBot = await BotConfig.findOne({ teamName }).lean();
            if (newBot) {
                const teamConfigs = botConfigToTeamConfigs(newBot);
                const mainClient = getDashboardClient();
                if (mainClient) {
                    for (const tc of teamConfigs) {
                        await loginSingleVoiceBot(tc, mainClient);
                    }
                }
            }
        } catch (connectErr: any) {
            logError("Dashboard", `Auto-connect failed for "${teamName}": ${connectErr.message}`);
        }

        res.redirect("/");
    } catch (err: any) {
        res.render("addBot", { user: req.user, error: err.message || "Failed to add bot", meta: resolveMeta("addBot") });
    }
});

// ─── Bot detail ──────────────────────────────────────────────────────
dashboardRouter.get("/bots/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.redirect("/"); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.redirect("/"); return;
    }

    const leaders = getLeadersFromCache(bot.leaderRoleId);

    // Build teamName query — split bots store workshops/sessions under expanded names
    const teamNameQuery = bot.isSplit
        ? { $in: [`${bot.teamName} (Beginner)`, `${bot.teamName} (Advanced)`, bot.teamName] }
        : bot.teamName;

    // Get session count per leader
    const leaderSessionCounts: Record<string, number> = {};
    for (const l of leaders) {
        leaderSessionCounts[l.id] = await Session.countDocuments({ leaderID: { $in: [l.id, bot.leaderRoleId] }, teamName: teamNameQuery });
    }

    const workshops = await Workshop.find({ teamName: teamNameQuery }).sort({ startTime: -1 }).limit(50).lean();
    const sessions = await Session.find({ teamName: teamNameQuery }).sort({ createdAt: -1 }).limit(20).lean();

    // Attach participant count to each workshop
    const workshopsWithCount = await Promise.all(workshops.map(async (ws) => {
        const participantCount = await Participant.countDocuments({ workshopId: ws.workshopId });
        return { ...ws, participantCount };
    }));

    // Enrich leaders with session counts
    const leadersWithStats = leaders.map(l => ({
        ...l,
        sessionCount: leaderSessionCounts[l.id] || 0,
    }));

    // Resolve role names
    const resolvedRoles = {
        leaderRoleName: resolveRoleName(bot.leaderRoleId),
        membersRoleName: resolveRoleName(bot.membersRoleId),
        additionalRoleName: resolveRoleName(bot.additionalMembersRoleId || ""),
    };

    // Resolve channel names
    const resolvedChannels = {
        leaderChatName: resolveChannelName(bot.leaderChatChannelId || ""),
        generalAnnName: resolveChannelName(bot.generalAnnChannelId || ""),
        voiceChannelName: resolveChannelName(bot.voiceChannelId || ""),
    };

    // Online leader IDs for green dot indicators
    const onlineUserIds = getOnlineUsers().map(u => u.discordId);

    res.render("botDetail", {
        bot: { ...bot, leaders: leadersWithStats },
        workshops: workshopsWithCount,
        sessions,
        user: req.user,
        resolvedRoles,
        resolvedChannels,
        onlineUserIds,
        meta: resolveMeta("botDetail", bot.teamName),
    });
});

// ─── Edit bot ────────────────────────────────────────────────────────
dashboardRouter.get("/bots/:id/edit", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.redirect("/"); return; }

    // Resolve the bot's current Discord avatar
    let botAvatarUrl = "/public/assets/default.png";
    try {
        const voiceBot = getVoiceBot(bot.isSplit ? `${bot.teamName} (Beginner)` : bot.teamName);
        if (voiceBot && (voiceBot as any).client?.user) {
            botAvatarUrl = (voiceBot as any).client.user.displayAvatarURL({ size: 128, extension: "png" });
        }
    } catch { /* fallback to default */ }

    res.render("editBot", { bot, user: req.user, error: null, botAvatarUrl, meta: resolveMeta("editBot", bot.teamName) });
});

dashboardRouter.post("/bots/:id/edit", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }

    try {
        const {
            teamName, leaderRoleId, membersRoleId, additionalMembersRoleId,
            isSplit, botToken, botId, voiceChannelId,
            botToken1, botToken2, voiceChannelId1, voiceChannelId2, specialRoleId,
            leaderChatChannelId, generalAnnChannelId, isActive,
        } = req.body;

        const splitBool = isSplit === "true" || isSplit === "on";
        const canEditTokens = req.user!.role === "dev";
        const updateData: any = {
            teamName,
            leaderRoleId: leaderRoleId || "",
            membersRoleId: membersRoleId || "",
            additionalMembersRoleId: additionalMembersRoleId || "",
            isSplit: splitBool,
            leaderChatChannelId: leaderChatChannelId || "",
            generalAnnChannelId: generalAnnChannelId || "",
            isActive: isActive === "true" || isActive === "on",
        };

        if (splitBool) {
            // Only dev can modify tokens — preserve existing values
            if (!canEditTokens) {
                const existing = await BotConfig.findById(req.params.id).lean();
                updateData.splitConfig = {
                    botToken1: existing?.splitConfig?.botToken1 || "",
                    botToken2: existing?.splitConfig?.botToken2 || "",
                    voiceChannelId1, voiceChannelId2,
                    specialRoleId: specialRoleId || "",
                };
            } else {
                updateData.splitConfig = { botToken1, botToken2, voiceChannelId1, voiceChannelId2, specialRoleId: specialRoleId || "" };
            }
            updateData.botToken = "";
            updateData.botId = "";
            updateData.voiceChannelId = "";
        } else {
            if (!canEditTokens) {
                const existing = await BotConfig.findById(req.params.id).lean();
                updateData.botToken = existing?.botToken || "";
                updateData.botId = existing?.botId || "";
            } else {
                updateData.botToken = botToken || "";
                updateData.botId = botId || "";
            }
            updateData.voiceChannelId = voiceChannelId || "";
            updateData.splitConfig = undefined;
        }

        await BotConfig.findByIdAndUpdate(req.params.id, updateData);
        logSuccess("Dashboard", `Bot "${teamName}" updated by ${req.user!.username}`);
        emitBotDataUpdate(teamName, { event: "config:updated" });
        res.redirect(`/bots/${req.params.id}`);
    } catch (err: any) {
        const bot = await BotConfig.findById(req.params.id).lean();
        res.render("editBot", { bot, user: req.user, error: err.message || "Failed to update", botAvatarUrl: "/public/assets/default.png", meta: resolveMeta("editBot") });
    }
});

// ─── Delete bot ──────────────────────────────────────────────────────
dashboardRouter.post("/bots/:id/delete", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }
    await BotConfig.findByIdAndDelete(req.params.id);
    logSuccess("Dashboard", `Bot deleted by ${req.user!.username}`);
    emitBotListChange();
    res.redirect("/");
});

// ─── Toggle active ───────────────────────────────────────────────────
dashboardRouter.post("/bots/:id/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.redirect("/"); return; }
    const bot = await BotConfig.findById(req.params.id);
    if (bot) {
        bot.isActive = !bot.isActive;
        await bot.save();

        // Actually disconnect/reconnect the voice bot (split-aware)
        if (bot.isSplit) {
            if (!bot.isActive) {
                await deactivateVoiceBot(`${bot.teamName} (Beginner)`);
                await deactivateVoiceBot(`${bot.teamName} (Advanced)`);
            } else {
                await activateVoiceBot(`${bot.teamName} (Beginner)`);
                await activateVoiceBot(`${bot.teamName} (Advanced)`);
            }
        } else {
            if (!bot.isActive) {
                await deactivateVoiceBot(bot.teamName);
            } else {
                await activateVoiceBot(bot.teamName);
            }
        }
        emitBotStatus(bot.teamName, { status: bot.isActive ? "activated" : "deactivated" });
    }
    res.redirect("/");
});

// ─── Web Console / Terminal ──────────────────────────────────────
dashboardRouter.get("/console", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.redirect("/"); return; }
    res.render("console", { user: req.user, meta: resolveMeta("console") });
});

dashboardRouter.get("/api/logs", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.status(403).json({ error: "Forbidden" }); return; }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const level = req.query.level as string | undefined;
    let logs = getWebLogs(limit);
    if (level && level !== "all") {
        logs = logs.filter(l => l.level === level);
    }
    res.json(logs);
});

// ─── Dev Panel (dev or whitelisted) ──────────────────────────────────
dashboardRouter.get("/dev", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.redirect("/"); return; }
    const bots = await BotConfig.find().sort({ teamName: 1 }).lean();
    const whitelistIds = (await Whitelist.find().lean()).map(w => w.discordId);
    res.render("dev", { user: req.user, bots, whitelistIds, meta: resolveMeta("dev") });
});

// Login log API
dashboardRouter.get("/api/dev/login-log", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.status(403).json({ error: "Forbidden" }); return; }
    res.json(getLoginLog());
});

// All registered users with online/offline status (includes leaders + BE)
dashboardRouter.get("/api/dev/all-users", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.status(403).json({ error: "Forbidden" }); return; }
    const loginLog = getLoginLog();
    const onlineUsers = getOnlineUsers();
    const onlineIds = new Set(onlineUsers.map(u => u.discordId));

    // Deduplicate by discordId, keep most recent entry
    const seen = new Map<string, any>();
    for (const entry of loginLog) {
        if (!seen.has(entry.discordId)) {
            seen.set(entry.discordId, {
                discordId: entry.discordId,
                username: entry.username,
                globalName: entry.globalName,
                avatarUrl: entry.avatarUrl,
                role: entry.role,
                lastSeen: entry.timestamp,
                isOnline: onlineIds.has(entry.discordId),
                currentPage: onlineUsers.find(u => u.discordId === entry.discordId)?.currentPage || null,
            });
        }
    }
    // Add any online users not in login log
    for (const u of onlineUsers) {
        if (!seen.has(u.discordId)) {
            seen.set(u.discordId, {
                discordId: u.discordId,
                username: u.username,
                globalName: u.globalName,
                avatarUrl: u.avatarUrl,
                role: u.role,
                lastSeen: u.connectedAt,
                isOnline: true,
                currentPage: u.currentPage,
            });
        }
    }

    // Include all leaders from all active teams + BE user from Discord cache
    // Collect leader role IDs for priority resolution
    const leaderRoleIdSet = new Set<string>();
    try {
        const allConfigs = await BotConfig.find({ isActive: true }).lean();
        const client = getDashboardClient();
        const guild = client && GUILD_ID ? client.guilds.cache.get(GUILD_ID) : null;

        for (const cfg of allConfigs) {
            if (cfg.leaderRoleId) leaderRoleIdSet.add(cfg.leaderRoleId);
        }

        /** Resolve highest-priority role for a guild member.
         *  Priority: DEV > ADMIN > BE > LEADER */
        function resolveMemberRole(member: import("discord.js").GuildMember): "dev" | "admin" | "be" | "leader" {
            if (member.id === DEV_USER_ID) return "dev";
            if (ADMIN_ID && member.roles.cache.has(ADMIN_ID)) return "admin";
            if (BE_ID && member.roles.cache.has(BE_ID)) return "be";
            return "leader";
        }

        if (guild) {
            // Add leaders from all teams
            for (const cfg of allConfigs) {
                if (!cfg.leaderRoleId) continue;
                const role = guild.roles.cache.get(cfg.leaderRoleId);
                if (!role) continue;
                for (const [, member] of role.members) {
                    if (!seen.has(member.id)) {
                        seen.set(member.id, {
                            discordId: member.id,
                            username: member.user.username,
                            globalName: member.displayName,
                            avatarUrl: member.user.displayAvatarURL({ size: 64, extension: "png" }),
                            role: resolveMemberRole(member),
                            lastSeen: null,
                            isOnline: onlineIds.has(member.id),
                            currentPage: onlineUsers.find(u => u.discordId === member.id)?.currentPage || null,
                        });
                    }
                }
            }

            // Add BE user if defined
            if (BE_ID) {
                const beRole = guild.roles.cache.get(BE_ID);
                if (beRole) {
                    for (const [, member] of beRole.members) {
                        if (!seen.has(member.id)) {
                            seen.set(member.id, {
                                discordId: member.id,
                                username: member.user.username,
                                globalName: member.displayName,
                                avatarUrl: member.user.displayAvatarURL({ size: 64, extension: "png" }),
                                role: resolveMemberRole(member),
                                lastSeen: null,
                                isOnline: onlineIds.has(member.id),
                                currentPage: onlineUsers.find(u => u.discordId === member.id)?.currentPage || null,
                            });
                        }
                    }
                }
            }

            // Add Admin role members if defined
            if (ADMIN_ID) {
                const adminRole = guild.roles.cache.get(ADMIN_ID);
                if (adminRole) {
                    for (const [, member] of adminRole.members) {
                        if (!seen.has(member.id)) {
                            seen.set(member.id, {
                                discordId: member.id,
                                username: member.user.username,
                                globalName: member.displayName,
                                avatarUrl: member.user.displayAvatarURL({ size: 64, extension: "png" }),
                                role: resolveMemberRole(member),
                                lastSeen: null,
                                isOnline: onlineIds.has(member.id),
                                currentPage: onlineUsers.find(u => u.discordId === member.id)?.currentPage || null,
                            });
                        }
                    }
                }
            }
        }
    } catch { /* silent */ }

    // Add whitelist status
    const whitelistEntries = await Whitelist.find().lean();
    const whitelistIds = new Set(whitelistEntries.map(w => w.discordId));

    // Sort: online first, then by role priority (DEV > ADMIN > BE > LEADER), then by lastSeen
    const rolePriority: Record<string, number> = { dev: 0, admin: 1, be: 2, leader: 3 };
    const users = Array.from(seen.values()).map(u => ({
        ...u,
        isWhitelisted: whitelistIds.has(u.discordId),
    })).sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        const rp = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
        if (rp !== 0) return rp;
        if (a.lastSeen && b.lastSeen) return b.lastSeen - a.lastSeen;
        return a.lastSeen ? -1 : b.lastSeen ? 1 : 0;
    });
    res.json(users);
});

// Kick (force-logout) a user from the dashboard
dashboardRouter.post("/api/dev/kick", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!isDevOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
    const { discordId } = req.body;
    if (!discordId) { res.status(400).json({ error: "Missing discordId" }); return; }
    const kicked = kickUser(discordId);
    res.json({ success: true, kicked });
});

// ─── Whitelist management (dev owner only) ───────────────────────────
dashboardRouter.post("/api/dev/whitelist/add", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!isDevOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
    const { discordId } = req.body;
    if (!discordId) { res.status(400).json({ error: "Missing discordId" }); return; }
    try {
        await Whitelist.findOneAndUpdate(
            { discordId },
            { discordId, addedBy: req.user!.discordId },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dashboardRouter.post("/api/dev/whitelist/remove", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!isDevOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
    const { discordId } = req.body;
    if (!discordId) { res.status(400).json({ error: "Missing discordId" }); return; }
    await Whitelist.deleteOne({ discordId });
    res.json({ success: true });
});

dashboardRouter.get("/api/dev/whitelist", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!(await hasDevAccess(req.user!))) { res.status(403).json({ error: "Forbidden" }); return; }
    const list = await Whitelist.find().lean();
    res.json(list);
});

// Bot reconnect API (dev only)
dashboardRouter.post("/api/bots/:id/reconnect", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!isDevOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
    try {
        if (bot.isSplit) {
            await reconnectVoiceBot(`${bot.teamName} (Beginner)`);
            await reconnectVoiceBot(`${bot.teamName} (Advanced)`);
        } else {
            await reconnectVoiceBot(bot.teamName);
        }
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Bot disconnect API (dev only)
dashboardRouter.post("/api/bots/:id/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!isDevOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
    try {
        if (bot.isSplit) {
            await disconnectVoiceBot(`${bot.teamName} (Beginner)`);
            await disconnectVoiceBot(`${bot.teamName} (Advanced)`);
        } else {
            await disconnectVoiceBot(bot.teamName);
        }
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Live Data View ──────────────────────────────────────────────────
dashboardRouter.get("/bots/:id/data", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.redirect("/"); return; }

    // Leaders can only see their own teams
    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.redirect("/"); return;
    }

    const dataTeamQuery = bot.isSplit
        ? { $in: [`${bot.teamName} (Beginner)`, `${bot.teamName} (Advanced)`, bot.teamName] }
        : bot.teamName;

    const workshops = await Workshop.find({ teamName: dataTeamQuery }).sort({ startTime: -1 }).limit(50).lean();

    // For each workshop, fetch participant count
    const workshopData = await Promise.all(workshops.map(async (ws) => {
        const participantCount = await Participant.countDocuments({ workshopId: ws.workshopId });
        return { ...ws, participantCount };
    }));

    res.render("botData", { bot, workshops: workshopData, user: req.user, meta: resolveMeta("botData", bot.teamName) });
});

// ─── Workshop Participants (AJAX) ────────────────────────────────────
dashboardRouter.get("/api/workshops/:workshopId/participants", requireAuth, async (req: AuthRequest, res: Response) => {
    const participants = await Participant.find({ workshopId: req.params.workshopId }).lean();
    const data = participants.map(p => {
        const totalVoiceMs = liveVoiceMs(p.voiceSessions);
        const totalMicMs = liveMicMs(p.micActivity);
        const totalDeafenMs = liveDeafenMs(p.deafenActivity);
        return {
            username: p.username,
            discordId: p.discordId,
            teamLabel: p.teamLabel,
            totalVoiceMs,
            totalMicMs,
            totalDeafenMs,
            voiceChatMessages: p.voiceChatMessages,
            memberChatMessages: p.memberChatMessages,
            stayedUntilEnd: p.stayedUntilEnd,
            joinCount: p.voiceSessions.length,
        };
    });
    res.json(data);
});

// ─── Token Access Request (BE → Dev DM) ─────────────────────────────
dashboardRouter.post("/api/token-request", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role !== "be") { res.status(403).json({ error: "Forbidden" }); return; }

    const { botId, label } = req.body;
    if (!botId || !label) { res.status(400).json({ error: "Missing botId or label" }); return; }

    try {
        const bot = await BotConfig.findById(botId).lean();
        const teamName = bot?.teamName || "Unknown";
        const requester = req.user!.globalName || req.user!.username;

        // Send DM to dev
        const client = getDashboardClient();
        if (client && DEV_USER_ID) {
            try {
                const devUser = await client.users.fetch(DEV_USER_ID);
                await devUser.send(
                    `🔑 **Token Access Request**\n` +
                    `**From:** ${requester} (${req.user!.discordId})\n` +
                    `**Team:** ${teamName}\n` +
                    `**Field:** ${label}\n` +
                    `**Time:** ${new Date().toLocaleString()}`
                );
            } catch (dmErr: any) {
                logError("Token Request DM", dmErr);
            }
        }

        logDebug("Token Request", `${requester} requested "${label}" for ${teamName}`);
        res.json({ ok: true });
    } catch (err: any) {
        logError("Token Request", err);
        res.status(500).json({ error: "Failed" });
    }
});

// ─── Export Workshop XLSX ─────────────────────────────────────────────
dashboardRouter.get("/bots/:id/export/:workshopId", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.redirect("/"); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.redirect("/"); return;
    }

    try {
        const workshopId = req.params.workshopId as string;
        const workshop = await Workshop.findOne({ workshopId });
        if (!workshop) { res.status(404).send("Workshop not found"); return; }

        const participants = await Participant.find({ workshopId });
        const filePath = await exportWorkshopToExcel(workshopId, workshop, participants);

        res.download(filePath);
    } catch (err: any) {
        logError("Dashboard Export", err);
        res.status(500).send("Export failed");
    }
});

// ─── Session Participants (AJAX — same as workshop) ──────────────────
dashboardRouter.get("/api/sessions/:workshopId/participants", requireAuth, async (req: AuthRequest, res: Response) => {
    const participants = await Participant.find({ workshopId: req.params.workshopId }).lean();
    const data = participants.map(p => {
        const totalVoiceMs = liveVoiceMs(p.voiceSessions);
        const totalMicMs = liveMicMs(p.micActivity);
        const totalDeafenMs = liveDeafenMs(p.deafenActivity);
        return {
            username: p.username,
            discordId: p.discordId,
            teamLabel: p.teamLabel,
            totalVoiceMs,
            totalMicMs,
            totalDeafenMs,
            voiceChatMessages: p.voiceChatMessages,
            memberChatMessages: p.memberChatMessages,
            stayedUntilEnd: p.stayedUntilEnd,
            joinCount: p.voiceSessions.length,
        };
    });
    res.json(data);
});

// ─── Export Session XLSX (reuses workshop export) ─────────────────────
dashboardRouter.get("/bots/:id/export-session/:workshopId", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.redirect("/"); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.redirect("/"); return;
    }

    try {
        const workshopId = req.params.workshopId as string;
        const workshop = await Workshop.findOne({ workshopId });
        if (!workshop) { res.status(404).send("Workshop not found"); return; }

        const participants = await Participant.find({ workshopId });
        const filePath = await exportWorkshopToExcel(workshopId, workshop, participants);

        res.download(filePath);
    } catch (err: any) {
        logError("Dashboard Session Export", err);
        res.status(500).send("Export failed");
    }
});

// ─── Disconnect voice bot (manual) ──────────────────────────────────
dashboardRouter.post("/api/bots/:id/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.status(403).json({ error: "Forbidden" }); return; }
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    // For split bots, accept ?subBot=beginner|advanced|all (default all)
    if (bot.isSplit) {
        const sub = ((req.query.subBot || req.body.subBot) as string || "all").toLowerCase();
        const results: { name: string; ok: boolean }[] = [];
        if (sub === "beginner" || sub === "all") {
            results.push({ name: "Beginner", ok: disconnectVoiceBot(`${bot.teamName} (Beginner)`) });
        }
        if (sub === "advanced" || sub === "all") {
            results.push({ name: "Advanced", ok: disconnectVoiceBot(`${bot.teamName} (Advanced)`) });
        }
        const allOk = results.every(r => r.ok);
        const msg = results.map(r => `${r.name}: ${r.ok ? "disconnected" : "not found"}`).join(", ");
        res.json({ ok: allOk, message: msg });
        return;
    }

    const ok = disconnectVoiceBot(bot.teamName);
    res.json({ ok, message: ok ? "Bot disconnected from voice" : "Bot not found in voice manager" });
});

// ─── Reconnect voice bot ────────────────────────────────────────────
dashboardRouter.post("/api/bots/:id/reconnect", requireAuth, async (req: AuthRequest, res: Response) => {
    if (req.user!.role === "leader") { res.status(403).json({ error: "Forbidden" }); return; }
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    // For split bots, accept ?subBot=beginner|advanced|all (default all)
    if (bot.isSplit) {
        const sub = ((req.query.subBot || req.body.subBot) as string || "all").toLowerCase();
        const results: { name: string; ok: boolean }[] = [];
        if (sub === "beginner" || sub === "all") {
            results.push({ name: "Beginner", ok: reconnectVoiceBot(`${bot.teamName} (Beginner)`) });
        }
        if (sub === "advanced" || sub === "all") {
            results.push({ name: "Advanced", ok: reconnectVoiceBot(`${bot.teamName} (Advanced)`) });
        }
        const allOk = results.every(r => r.ok);
        const msg = results.map(r => `${r.name}: ${r.ok ? "reconnecting" : "not found"}`).join(", ");
        res.json({ ok: allOk, message: msg });
        return;
    }

    const ok = reconnectVoiceBot(bot.teamName);
    res.json({ ok, message: ok ? "Bot reconnecting..." : "Bot not found in voice manager" });
});

// ─── Update bot Discord profile ─────────────────────────────────────
dashboardRouter.post("/api/bots/:id/profile", requireAuth, async (req: AuthRequest, res: Response) => {
    const role = req.user!.role;
    if (role !== "dev" && role !== "be") { res.status(403).json({ error: "Forbidden" }); return; }

    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    const { username: newName, avatarUrl: newAvatar } = req.body;
    const result = await updateBotProfile(bot.teamName, {
        username: newName || undefined,
        avatarUrl: newAvatar || undefined,
    });
    if (result.success) emitBotDataUpdate(bot.teamName, { event: "profile:updated", detail: result.message });
    res.json(result);
});

// ─── Start workshop from web (leader or above) ─────────────────────
dashboardRouter.post("/api/bots/:id/workshop/start", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    // Leader can only start for their own team
    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.status(403).json({ error: "Forbidden" }); return;
    }

    const { type, duration, startTime: startTimeStr, subBot } = req.body;
    if (!type || !duration) { res.status(400).json({ error: "Missing type or duration" }); return; }

    const mainClient = getDashboardClient();
    if (!mainClient) { res.status(500).json({ error: "Main bot not ready" }); return; }

    // Build TeamConfig from BotConfig
    const teamConfigs = botConfigToTeamConfigs(bot);
    // For split bots, subBot selects Beginner (0) or Advanced (1); default to 0
    const configIndex = bot.isSplit ? (subBot === 1 ? 1 : 0) : 0;
    const teamConfig = teamConfigs[configIndex];
    if (!teamConfig) { res.status(404).json({ error: "Team config not found" }); return; }

    // Use provided start time or default to now
    const startTime = startTimeStr ? new Date(startTimeStr) : new Date();

    try {
        const result = await createWorkshop(
            bot.leaderRoleId, // leaderID (role ID)
            teamConfig,
            type as "workshop" | "formation" | "other",
            startTime,
            duration,
            mainClient,
        );
        if (result.success) emitBotDataUpdate(bot.teamName, { event: "workshop:started", detail: result });
        res.json(result);
    } catch (err: any) {
        logError("Web Workshop Start", err);
        res.status(500).json({ success: false, message: err.message || "Failed to start workshop" });
    }
});

// ─── Stop workshop from web ─────────────────────────────────────────
dashboardRouter.post("/api/bots/:id/workshop/stop", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.status(403).json({ error: "Forbidden" }); return;
    }

    const mainClient = getDashboardClient();
    if (!mainClient) { res.status(500).json({ error: "Main bot not ready" }); return; }

    const { workshopId } = req.body;
    if (!workshopId) { res.status(400).json({ error: "Missing workshopId" }); return; }

    try {
        const result = await stopWorkshop(workshopId, mainClient);
        if (result.success) emitBotDataUpdate(bot.teamName, { event: "workshop:stopped", detail: result });
        res.json(result);
    } catch (err: any) {
        logError("Web Workshop Stop", err);
        res.status(500).json({ success: false, message: err.message || "Failed to stop workshop" });
    }
});

// ─── Team Members Stats (AJAX) ──────────────────────────────────────
dashboardRouter.get("/api/bots/:id/members", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.status(403).json({ error: "Forbidden" }); return;
    }

    try {
        const client = getDashboardClient();
        if (!client || !GUILD_ID) { res.json([]); return; }

        const guild = await client.guilds.fetch(GUILD_ID);
        const membersRoleId = bot.membersRoleId;
        const additionalRoleId = bot.additionalMembersRoleId;

        // Build split-aware team name query
        const memberTeamQuery = bot.isSplit
            ? { $in: [`${bot.teamName} (Beginner)`, `${bot.teamName} (Advanced)`, bot.teamName] }
            : bot.teamName;

        // Get all workshop IDs for this team
        const teamWorkshops = await Workshop.find({ teamName: memberTeamQuery }).lean();
        const teamWorkshopIds = teamWorkshops.map(w => w.workshopId);

        // Fetch guild members with the team's roles
        const guildMembers = guild.members.cache.filter(m => {
            if (m.user.bot) return false;
            if (membersRoleId && m.roles.cache.has(membersRoleId)) return true;
            if (additionalRoleId && m.roles.cache.has(additionalRoleId)) return true;
            return false;
        });

        // For each member, aggregate their workshop participation stats
        const memberData = await Promise.all(
            guildMembers.map(async (member) => {
                const participants = await Participant.find({
                    discordId: member.id,
                    workshopId: { $in: teamWorkshopIds },
                }).lean();
                let totalVoiceMs = 0, totalMicMs = 0, totalMsgs = 0, workshopsJoined = 0, stayedCount = 0;

                for (const p of participants) {
                    workshopsJoined++;
                    totalVoiceMs += liveVoiceMs(p.voiceSessions);
                    totalMicMs += liveMicMs(p.micActivity);
                    totalMsgs += (p.voiceChatMessages || 0) + (p.memberChatMessages || 0);
                    if (p.stayedUntilEnd) stayedCount++;
                }

                return {
                    discordId: member.id,
                    username: member.user.username,
                    globalName: member.displayName,
                    avatarUrl: member.user.displayAvatarURL({ size: 64 }),
                    workshopsJoined,
                    totalVoiceMs,
                    totalMicMs,
                    totalMsgs,
                    stayedCount,
                    leftEarlyCount: workshopsJoined - stayedCount,
                };
            })
        );

        res.json(memberData.sort((a, b) => b.workshopsJoined - a.workshopsJoined));
    } catch (err: any) {
        logError("Team Members API", err);
        res.status(500).json({ error: "Failed to fetch members" });
    }
});

// ─── Team Leaderboard (AJAX) ─────────────────────────────────────────
dashboardRouter.get("/api/bots/:id/leaderboard", requireAuth, async (req: AuthRequest, res: Response) => {
    const bot = await BotConfig.findById(req.params.id).lean();
    if (!bot) { res.status(404).json({ error: "Not found" }); return; }

    if (req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
        res.status(403).json({ error: "Forbidden" }); return;
    }

    try {
        const period = (req.query.period as string) || "all";
        let dateFilter: any = {};
        const now = new Date();

        if (period === "week") {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            dateFilter.startTime = { $gte: weekAgo };
        } else if (period === "month") {
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            dateFilter.startTime = { $gte: monthAgo };
        }

        // Get all sessions for this team (split-aware)
        const lbTeamQuery = bot.isSplit
            ? { $in: [`${bot.teamName} (Beginner)`, `${bot.teamName} (Advanced)`, bot.teamName] }
            : bot.teamName;
        const sessions = await Session.find({ teamName: lbTeamQuery, ...dateFilter }).lean();

        // Get all participants for those workshops
        const workshopIds = sessions.map(s => s.workshopId);
        const participants = await Participant.find({
            workshopId: { $in: workshopIds },
        }).lean();

        // Aggregate per member
        const memberMap: Record<string, { discordId: string; username: string; sessions: number; totalVoiceMs: number; totalMicMs: number; totalMsgs: number; stayedCount: number }> = {};

        for (const p of participants) {
            if (!memberMap[p.discordId]) {
                memberMap[p.discordId] = {
                    discordId: p.discordId,
                    username: p.username,
                    sessions: 0,
                    totalVoiceMs: 0,
                    totalMicMs: 0,
                    totalMsgs: 0,
                    stayedCount: 0,
                };
            }
            const m = memberMap[p.discordId];
            m.sessions++;
            m.totalVoiceMs += liveVoiceMs(p.voiceSessions);
            m.totalMicMs += liveMicMs(p.micActivity);
            m.totalMsgs += (p.voiceChatMessages || 0) + (p.memberChatMessages || 0);
            if (p.stayedUntilEnd) m.stayedCount++;
        }

        // Resolve display names from cache
        const client = getDashboardClient();
        const guild = client && GUILD_ID ? client.guilds.cache.get(GUILD_ID) : null;
        const leaderboard = Object.values(memberMap).map(m => {
            const guildMember = guild?.members.cache.get(m.discordId);
            return {
                ...m,
                globalName: guildMember?.displayName || m.username,
                avatarUrl: guildMember?.user.displayAvatarURL({ size: 64 }) || "",
            };
        }).sort((a, b) => b.sessions - a.sessions || b.totalVoiceMs - a.totalVoiceMs);

        res.json({ totalSessions: sessions.length, leaderboard });
    } catch (err: any) {
        logError("Leaderboard API", err);
        res.status(500).json({ error: "Failed to build leaderboard" });
    }
});

// ─── Session Detail (AJAX) ──────────────────────────────────────────
dashboardRouter.get("/api/sessions/:workshopId/detail", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const session = await Session.findOne({ workshopId: req.params.workshopId }).lean();
        if (!session) { res.status(404).json({ error: "Session not found" }); return; }

        const workshop = await Workshop.findOne({ workshopId: req.params.workshopId }).lean();

        // Resolve leader name
        const client = getDashboardClient();
        const guild = client && GUILD_ID ? client.guilds.cache.get(GUILD_ID) : null;
        let leaderName = session.leaderID;
        if (guild) {
            const leaderMember = guild.members.cache.get(session.leaderID);
            if (leaderMember) leaderName = leaderMember.displayName;
            // Also try role name if it's a role ID
            const role = guild.roles.cache.get(session.leaderID);
            if (role) leaderName = `@${role.name}`;
        }

        res.json({
            workshopId: session.workshopId,
            teamName: session.teamName,
            leaderID: session.leaderID,
            leaderName,
            type: session.type,
            startTime: session.startTime,
            endTime: session.endTime,
            totalDuration: session.totalDuration,
            totalParticipants: session.totalParticipants,
            averageAttendanceTime: session.averageAttendanceTime,
            workshopStatus: workshop?.status || "completed",
            averageDuration: workshop?.averageDuration || 0,
        });
    } catch (err: any) {
        logError("Session Detail API", err);
        res.status(500).json({ error: "Failed to fetch session detail" });
    }
});

// ─── Stop Active Session (AJAX) ─────────────────────────────────────
dashboardRouter.post("/api/sessions/:workshopId/stop", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const workshop = await Workshop.findOne({ workshopId: req.params.workshopId, status: "active" });
        if (!workshop) { res.status(404).json({ success: false, message: "No active workshop found" }); return; }

        // Check permissions — leader can only stop their own team
        const bot = await BotConfig.findOne({ teamName: workshop.teamName }).lean();
        if (bot && req.user!.role === "leader" && !req.user!.leaderTeamIds.includes((bot as any)._id.toString())) {
            res.status(403).json({ success: false, message: "Forbidden" }); return;
        }

        const mainClient = getDashboardClient();
        if (!mainClient) { res.status(500).json({ success: false, message: "Main bot not ready" }); return; }

        const result = await stopWorkshop(workshop.workshopId, mainClient);
        if (result.success && bot) {
            emitBotDataUpdate(bot.teamName, { event: "workshop:stopped", detail: result });
        }
        res.json(result);
    } catch (err: any) {
        logError("Stop Session API", err);
        res.status(500).json({ success: false, message: "Failed to stop session" });
    }
});

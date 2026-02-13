import { Request, Response, NextFunction } from "express";

export interface DashboardUser {
    discordId: string;
    username: string;
    globalName: string;
    avatarUrl: string;
    role: "dev" | "be" | "admin" | "leader";
    leaderTeamIds: string[]; // BotConfig _id's for teams they lead
}

export interface AuthRequest extends Request {
    user?: DashboardUser;
}

/**
 * Middleware: require authentication.
 * Populates req.user from session.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
    const sessionUser = (req.session as any)?.user;
    if (!sessionUser) {
        res.redirect("/login");
        return;
    }
    req.user = sessionUser as DashboardUser;
    next();
}

/**
 * Meta OG data configuration for the ITC Bot Dashboard.
 * Edit this file to update Open Graph tags across all pages.
 */

export interface PageMeta {
    title: string;
    description: string;
    image?: string;          // OG image URL (not thumbnail)
    imageAlt?: string;
    themeColor?: string;
    type?: string;           // og:type — default "website"
    keywords?: string;
}

/** Base / fallback meta used across the entire dashboard */
export const baseMeta: PageMeta = {
    title: "ITC Bot Dashboard",
    description:
        "Manage and monitor your ITC Discord team bots, workshops, voice sessions, and team performance — all from one powerful dashboard.",
    image: "/public/assets/logo.png",
    imageAlt: "ITC Bot Dashboard Logo",
    themeColor: "#e63946",
    type: "website",
    keywords: "ITC, Discord, Bot, Dashboard, Workshop, Teams, Management",
};

/** Per-page meta overrides — merged with baseMeta at render time */
export const pageMeta: Record<string, Partial<PageMeta>> = {
    login: {
        title: "Sign In — ITC Bot Dashboard",
        description:
            "Sign in with Discord to access the ITC Bot Dashboard. Manage your team bots, workshops, and performance data.",
    },
    index: {
        title: "Bot Configurations — ITC Bot Dashboard",
        description:
            "View and manage all configured ITC team bots. Monitor status, leaders, and split configurations.",
    },
    botDetail: {
        title: "Team Detail — ITC Bot Dashboard",
        description:
            "Deep dive into your team's bot: workshops, sessions, leaderboard, and member statistics.",
    },
    editBot: {
        title: "Edit Bot — ITC Bot Dashboard",
        description:
            "Edit your team bot configuration: roles, channels, tokens, and split settings.",
    },
    addBot: {
        title: "Add Bot — ITC Bot Dashboard",
        description:
            "Register a new team bot with voice channels, roles, and split configurations.",
    },
    botData: {
        title: "Team Data — ITC Bot Dashboard",
        description:
            "Browse workshop history and participant data for your team.",
    },
    dev: {
        title: "Dev Panel — ITC Bot Dashboard",
        description:
            "Developer control panel: changelog, online users, login logs, bot management, and live notifications.",
    },
};

/**
 * Resolve page meta by merging page-specific overrides with baseMeta.
 * Optionally append a team name to the title.
 */
export function resolveMeta(page: string, teamName?: string): PageMeta {
    const override = pageMeta[page] || {};
    const merged: PageMeta = { ...baseMeta, ...override };
    if (teamName) {
        merged.title = `${teamName} — ${merged.title}`;
        merged.description = `${teamName} team: ${merged.description}`;
    }
    return merged;
}

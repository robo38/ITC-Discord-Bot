/**
 * Discord OAuth2 and API helpers for the dashboard.
 */

const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordUser {
    id: string;
    username: string;
    avatar: string | null;
    discriminator: string;
    global_name?: string | null;
}

/**
 * Build the Discord OAuth2 authorization URL.
 */
export function getOAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID || "",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify",
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.CLIENT_ID || "",
            client_secret: process.env.DISCORD_CLIENT_SECRET || "",
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        }),
    });
    const data: any = await res.json();
    if (!data.access_token) {
        throw new Error(data.error_description || data.error || "OAuth token exchange failed");
    }
    return data.access_token;
}

/**
 * Get the authenticated user's info using their OAuth access token.
 */
export async function getOAuthUser(accessToken: string): Promise<DiscordUser> {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Failed to fetch Discord user info");
    return res.json() as Promise<DiscordUser>;
}

/**
 * Get Discord avatar URL for a user.
 */
export function avatarUrl(user: { id: string; avatar?: string | null }, size = 64): string {
    if (user.avatar) {
        const ext = user.avatar.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
    }
    const index = Number((BigInt(user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png?size=${size}`;
}

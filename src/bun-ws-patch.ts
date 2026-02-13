/**
 * Bun compatibility patch for @discordjs/ws
 *
 * Bun's WebSocket implementation can pass non-object errors (strings, null, undefined)
 * to the onError handler. discord.js assumes `error` is always an object and does
 * `"code" in error`, which throws TypeError on non-object values.
 *
 * This preload script patches the prototype before any discord.js client is created.
 * Load via bunfig.toml: preload = ["./src/bun-ws-patch.ts"]
 */
import { resolve } from "path";

function patchWsModule(modulePath: string, label: string): boolean {
    try {
        const wsModule = require(modulePath);
        let patched = 0;
        for (const [key, value] of Object.entries(wsModule)) {
            const proto = (value as any)?.prototype;
            if (proto && typeof proto.onError === "function") {
                const origOnError = proto.onError;
                proto.onError = function (error: unknown) {
                    if (error === null || error === undefined || typeof error !== "object") {
                        console.warn(`[WS Patch] Non-object WebSocket error caught (${typeof error}):`, error);
                        return origOnError.call(this, new Error(String(error ?? "Unknown WebSocket error")));
                    }
                    return origOnError.call(this, error);
                };
                patched++;
            }
        }
        if (patched > 0) console.log(`[WS Patch] Patched ${patched} class(es) in ${label}`);
        return patched > 0;
    } catch {
        return false;
    }
}

// Try both locations: top-level and nested under discord.js
const topLevel = resolve("node_modules/@discordjs/ws/dist/index.js");
const nested = resolve("node_modules/discord.js/node_modules/@discordjs/ws/dist/index.js");

const patchedTop = patchWsModule(topLevel, "@discordjs/ws (top-level)");
const patchedNested = patchWsModule(nested, "@discordjs/ws (nested in discord.js)");

if (!patchedTop && !patchedNested) {
    console.warn("[WS Patch] Could not find @discordjs/ws in either location");
}

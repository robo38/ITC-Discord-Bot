import { Events, VoiceState, GuildMember } from "discord.js";
import { getAllActiveTrackers } from "../workshop";
import teamsData from "../data";

export default {
    name: Events.VoiceStateUpdate,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const trackers = getAllActiveTrackers();
        if (trackers.size === 0) return;

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        for (const [workshopId, tracker] of trackers) {
            const targetChannelId = tracker.teamConfig.voiceChannelID;
            if (!targetChannelId) continue;

            // ─── Join: user entered the tracked channel ──────────────
            if (newChannelId === targetChannelId && oldChannelId !== targetChannelId) {
                await tracker.handleJoin(member);
                continue;
            }

            // ─── Leave: user left the tracked channel ────────────────
            if (oldChannelId === targetChannelId && newChannelId !== targetChannelId) {
                await tracker.handleLeave(member.id);
                continue;
            }

            // ─── Still in the tracked channel — check state changes ──
            if (
                newChannelId === targetChannelId &&
                oldChannelId === targetChannelId &&
                tracker.isTracking(member.id)
            ) {
                // Mute change
                const wasMuted = oldState.selfMute || oldState.serverMute || false;
                const isMuted = newState.selfMute || newState.serverMute || false;
                if (wasMuted !== isMuted) {
                    await tracker.handleMuteChange(member.id, isMuted);
                }

                // Deafen change
                const wasDeafened = oldState.selfDeaf || oldState.serverDeaf || false;
                const isDeafened = newState.selfDeaf || newState.serverDeaf || false;
                if (wasDeafened !== isDeafened) {
                    await tracker.handleDeafenChange(member.id, isDeafened);
                }
            }
        }
    },
};

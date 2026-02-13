import {
    Client,
    GuildMember,
    VoiceState,
    ChannelType,
    VoiceChannel,
} from "discord.js";
import { Participant } from "../database";
import type { IParticipant } from "../database";
import { TeamConfig } from "../data";
import { logError } from "../utils/logger";
import { getTeamLabel } from "./workshopManager";
import {
    emitParticipantJoined,
    emitParticipantLeft,
} from "../dashboard/socketManager";

/**
 * Tracks voice activity, mic, deafen, and messages for all members
 * in a team's voice channel during an active workshop.
 */
export class ActivityTracker {
    public workshopId: string;
    public teamConfig: TeamConfig;
    public mainClient: Client;

    // In-memory state for currently connected users
    // discordId → { joinTime, isMuted, mutedSince, isDeafened, deafenedSince }
    private memberState: Map<
        string,
        {
            joinTime: Date;
            isMuted: boolean;
            mutedSince: Date | null;
            isDeafened: boolean;
            deafenedSince: Date | null;
        }
    > = new Map();

    // Per-member operation queue to prevent race conditions
    private memberLocks: Map<string, Promise<void>> = new Map();

    constructor(workshopId: string, teamConfig: TeamConfig, mainClient: Client) {
        this.workshopId = workshopId;
        this.teamConfig = teamConfig;
        this.mainClient = mainClient;
    }

    /**
     * Serialize async operations per member to prevent race conditions.
     */
    private async withMemberLock(discordId: string, fn: () => Promise<void>): Promise<void> {
        const prev = this.memberLocks.get(discordId) || Promise.resolve();
        const next = prev.then(fn, fn); // run even if previous failed
        this.memberLocks.set(discordId, next);
        await next;
    }

    /**
     * Scan existing members in the voice channel when tracking starts.
     */
    async scanExistingMembers(): Promise<void> {
        try {
            const channel = await this.mainClient.channels.fetch(this.teamConfig.voiceChannelID);
            if (!channel || channel.type !== ChannelType.GuildVoice) return;

            const voiceChannel = channel as VoiceChannel;
            for (const [, member] of voiceChannel.members) {
                if (member.user.bot) continue;
                await this.handleJoin(member);
            }
        } catch (error: any) {
            logError(`ActivityTracker (${this.teamConfig.TeamName}) scan`, error);
        }
    }

    /**
     * Handle a member joining the tracked voice channel.
     */
    async handleJoin(member: GuildMember): Promise<void> {
        await this.withMemberLock(member.id, () => this._handleJoin(member));
    }

    private async _handleJoin(member: GuildMember): Promise<void> {
        const now = new Date();
        const discordId = member.id;

        // Set in-memory state
        this.memberState.set(discordId, {
            joinTime: now,
            isMuted: member.voice.selfMute || member.voice.serverMute || false,
            mutedSince: (member.voice.selfMute || member.voice.serverMute) ? now : null,
            isDeafened: member.voice.selfDeaf || member.voice.serverDeaf || false,
            deafenedSince: (member.voice.selfDeaf || member.voice.serverDeaf) ? now : null,
        });

        // Determine team label
        const memberRoles = member.roles.cache.map((r) => r.id);
        const teamLabel = getTeamLabel(memberRoles, this.teamConfig);

        // Get or create participant doc
        let participant = await Participant.findOne({
            workshopId: this.workshopId,
            discordId,
        });

        if (!participant) {
            participant = new Participant({
                workshopId: this.workshopId,
                discordId,
                username: member.user.username,
                teamLabel,
                voiceSessions: [],
                micActivity: [],
                deafenActivity: [],
                voiceChatMessages: 0,
                memberChatMessages: 0,
                stayedUntilEnd: false,
            });
        }

        // Add new voice session
        participant.voiceSessions.push({
            joinTime: now,
            leaveTime: undefined,
            duration: 0,
        });

        // If mic is open, start mic tracking
        if (!member.voice.selfMute && !member.voice.serverMute) {
            participant.micActivity.push({
                unmutedAt: now,
                mutedAt: undefined,
                duration: 0,
            });
        }

        // If deafened, start deafen tracking
        if (member.voice.selfDeaf || member.voice.serverDeaf) {
            participant.deafenActivity.push({
                deafenedAt: now,
                undeafenedAt: undefined,
                duration: 0,
            });
        }

        await participant.save();

        // Emit participant joined
        emitParticipantJoined(this.teamConfig.TeamName, {
            workshopId: this.workshopId,
            userId: discordId,
            username: member.user.username,
        });
    }

    /**
     * Handle a member leaving the tracked voice channel.
     */
    async handleLeave(discordId: string): Promise<void> {
        await this.withMemberLock(discordId, () => this._handleLeave(discordId));
    }

    private async _handleLeave(discordId: string): Promise<void> {
        const now = new Date();
        const state = this.memberState.get(discordId);
        if (!state) return;

        const participant = await Participant.findOne({
            workshopId: this.workshopId,
            discordId,
        });

        if (participant) {
            // Close the last voice session
            const lastSession = participant.voiceSessions[participant.voiceSessions.length - 1];
            if (lastSession && !lastSession.leaveTime) {
                lastSession.leaveTime = now;
                lastSession.duration = now.getTime() - lastSession.joinTime.getTime();
            }

            // Close any open mic activity
            const lastMic = participant.micActivity[participant.micActivity.length - 1];
            if (lastMic && !lastMic.mutedAt) {
                lastMic.mutedAt = now;
                lastMic.duration = now.getTime() - lastMic.unmutedAt.getTime();
            }

            // Close any open deafen activity
            const lastDeafen = participant.deafenActivity[participant.deafenActivity.length - 1];
            if (lastDeafen && !lastDeafen.undeafenedAt) {
                lastDeafen.undeafenedAt = now;
                lastDeafen.duration = now.getTime() - lastDeafen.deafenedAt.getTime();
            }

            await participant.save();
        }

        // Emit participant left
        emitParticipantLeft(this.teamConfig.TeamName, {
            workshopId: this.workshopId,
            userId: discordId,
            username: participant?.username || discordId,
        });

        this.memberState.delete(discordId);
    }

    /**
     * Handle mute/unmute state change.
     */
    async handleMuteChange(discordId: string, isMuted: boolean): Promise<void> {
        await this.withMemberLock(discordId, () => this._handleMuteChange(discordId, isMuted));
    }

    private async _handleMuteChange(discordId: string, isMuted: boolean): Promise<void> {
        const now = new Date();
        const state = this.memberState.get(discordId);
        if (!state) return;

        const participant = await Participant.findOne({
            workshopId: this.workshopId,
            discordId,
        });

        if (!participant) return;

        if (isMuted && !state.isMuted) {
            // Was unmuted, now muted — close mic activity
            const lastMic = participant.micActivity[participant.micActivity.length - 1];
            if (lastMic && !lastMic.mutedAt) {
                lastMic.mutedAt = now;
                lastMic.duration = now.getTime() - lastMic.unmutedAt.getTime();
            }
        } else if (!isMuted && state.isMuted) {
            // Was muted, now unmuted — start new mic activity
            participant.micActivity.push({
                unmutedAt: now,
                mutedAt: undefined,
                duration: 0,
            });
        }

        state.isMuted = isMuted;
        state.mutedSince = isMuted ? now : null;

        await participant.save();
    }

    /**
     * Handle deafen/undeafen state change.
     */
    async handleDeafenChange(discordId: string, isDeafened: boolean): Promise<void> {
        await this.withMemberLock(discordId, () => this._handleDeafenChange(discordId, isDeafened));
    }

    private async _handleDeafenChange(discordId: string, isDeafened: boolean): Promise<void> {
        const now = new Date();
        const state = this.memberState.get(discordId);
        if (!state) return;

        const participant = await Participant.findOne({
            workshopId: this.workshopId,
            discordId,
        });

        if (!participant) return;

        if (isDeafened && !state.isDeafened) {
            // Was undeafened, now deafened
            participant.deafenActivity.push({
                deafenedAt: now,
                undeafenedAt: undefined,
                duration: 0,
            });
        } else if (!isDeafened && state.isDeafened) {
            // Was deafened, now undeafened
            const lastDeafen = participant.deafenActivity[participant.deafenActivity.length - 1];
            if (lastDeafen && !lastDeafen.undeafenedAt) {
                lastDeafen.undeafenedAt = now;
                lastDeafen.duration = now.getTime() - lastDeafen.deafenedAt.getTime();
            }
        }

        state.isDeafened = isDeafened;
        state.deafenedSince = isDeafened ? now : null;

        await participant.save();
    }

    /**
     * Increment message count for a user in voice text chat.
     */
    async handleVoiceChatMessage(discordId: string): Promise<void> {
        await Participant.updateOne(
            { workshopId: this.workshopId, discordId },
            { $inc: { voiceChatMessages: 1 } }
        );
    }

    /**
     * Increment message count for a user in member text chat.
     */
    async handleMemberChatMessage(discordId: string): Promise<void> {
        await Participant.updateOne(
            { workshopId: this.workshopId, discordId },
            { $inc: { memberChatMessages: 1 } }
        );
    }

    /**
     * Check if a user is currently being tracked.
     */
    isTracking(discordId: string): boolean {
        return this.memberState.has(discordId);
    }

    /**
     * Get the count of currently tracked members.
     */
    get trackedCount(): number {
        return this.memberState.size;
    }

    /**
     * Finalize all tracked members (mark them as stayed until end + close sessions).
     * Also catches any orphaned open sessions from DB as a safety net.
     */
    async finalizeAll(): Promise<void> {
        const now = new Date();

        // Wait for any pending member operations to complete
        await Promise.allSettled(Array.from(this.memberLocks.values()));

        // Set of members who are still in memberState (stayed until end)
        const stayedMembers = new Set(this.memberState.keys());

        // Fetch ALL participants for this workshop to catch orphaned sessions
        const allParticipants = await Participant.find({ workshopId: this.workshopId });

        for (const participant of allParticipants) {
            let changed = false;

            // Mark as stayed until end if still in memberState
            if (stayedMembers.has(participant.discordId)) {
                participant.stayedUntilEnd = true;
                changed = true;
            }

            // Close ALL open voice sessions (not just the last one)
            for (const session of participant.voiceSessions) {
                if (!session.leaveTime) {
                    session.leaveTime = now;
                    session.duration = now.getTime() - session.joinTime.getTime();
                    changed = true;
                }
            }

            // Close any open mic activity
            for (const mic of participant.micActivity) {
                if (!mic.mutedAt) {
                    mic.mutedAt = now;
                    mic.duration = now.getTime() - mic.unmutedAt.getTime();
                    changed = true;
                }
            }

            // Close any open deafen activity
            for (const deafen of participant.deafenActivity) {
                if (!deafen.undeafenedAt) {
                    deafen.undeafenedAt = now;
                    deafen.duration = now.getTime() - deafen.deafenedAt.getTime();
                    changed = true;
                }
            }

            if (changed) {
                await participant.save();
            }
        }

        this.memberState.clear();
        this.memberLocks.clear();
    }
}

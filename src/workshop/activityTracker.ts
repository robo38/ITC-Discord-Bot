import {
    Client,
    GuildMember,
    ChannelType,
    VoiceChannel,
} from "discord.js";
import { Participant } from "../database";
import { TeamConfig } from "../data";
import { logError } from "../utils/logger";
import { getTeamLabel } from "./workshopManager";
import {
    emitParticipantJoined,
    emitParticipantLeft,
} from "../dashboard/socketManager";

export class ActivityTracker {
    public workshopId: string;
    public teamConfig: TeamConfig;
    public mainClient: Client;

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

    private memberLocks: Map<string, Promise<void>> = new Map();

    constructor(workshopId: string, teamConfig: TeamConfig, mainClient: Client) {
        this.workshopId = workshopId;
        this.teamConfig = teamConfig;
        this.mainClient = mainClient;
    }

    private async withMemberLock(discordId: string, fn: () => Promise<void>): Promise<void> {
        const prev = this.memberLocks.get(discordId) || Promise.resolve();
        const next = prev.then(fn, fn);
        this.memberLocks.set(discordId, next);
        await next;
    }

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

    async handleJoin(member: GuildMember): Promise<void> {
        await this.withMemberLock(member.id, () => this._handleJoin(member));
    }

    private async _handleJoin(member: GuildMember): Promise<void> {
        const now = new Date();
        const discordId = member.id;

        this.memberState.set(discordId, {
            joinTime: now,
            isMuted: member.voice.selfMute || member.voice.serverMute || false,
            mutedSince: (member.voice.selfMute || member.voice.serverMute) ? now : null,
            isDeafened: member.voice.selfDeaf || member.voice.serverDeaf || false,
            deafenedSince: (member.voice.selfDeaf || member.voice.serverDeaf) ? now : null,
        });

        const memberRoles = member.roles.cache.map((r) => r.id);
        const teamLabel = getTeamLabel(memberRoles, this.teamConfig);

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

        participant.voiceSessions.push({
            joinTime: now,
            leaveTime: undefined,
            duration: 0,
        });

        if (!member.voice.selfMute && !member.voice.serverMute) {
            participant.micActivity.push({
                unmutedAt: now,
                mutedAt: undefined,
                duration: 0,
            });
        }

        if (member.voice.selfDeaf || member.voice.serverDeaf) {
            participant.deafenActivity.push({
                deafenedAt: now,
                undeafenedAt: undefined,
                duration: 0,
            });
        }

        await participant.save();

        emitParticipantJoined(this.teamConfig.TeamName, {
            workshopId: this.workshopId,
            userId: discordId,
            username: member.user.username,
        });
    }

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
            const lastSession = participant.voiceSessions[participant.voiceSessions.length - 1];
            if (lastSession && !lastSession.leaveTime) {
                lastSession.leaveTime = now;
                lastSession.duration = now.getTime() - lastSession.joinTime.getTime();
            }

            const lastMic = participant.micActivity[participant.micActivity.length - 1];
            if (lastMic && !lastMic.mutedAt) {
                lastMic.mutedAt = now;
                lastMic.duration = now.getTime() - lastMic.unmutedAt.getTime();
            }

            const lastDeafen = participant.deafenActivity[participant.deafenActivity.length - 1];
            if (lastDeafen && !lastDeafen.undeafenedAt) {
                lastDeafen.undeafenedAt = now;
                lastDeafen.duration = now.getTime() - lastDeafen.deafenedAt.getTime();
            }

            await participant.save();
        }

        emitParticipantLeft(this.teamConfig.TeamName, {
            workshopId: this.workshopId,
            userId: discordId,
            username: participant?.username || discordId,
        });

        this.memberState.delete(discordId);
    }

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
            const lastMic = participant.micActivity[participant.micActivity.length - 1];
            if (lastMic && !lastMic.mutedAt) {
                lastMic.mutedAt = now;
                lastMic.duration = now.getTime() - lastMic.unmutedAt.getTime();
            }
        } else if (!isMuted && state.isMuted) {
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
            participant.deafenActivity.push({
                deafenedAt: now,
                undeafenedAt: undefined,
                duration: 0,
            });
        } else if (!isDeafened && state.isDeafened) {
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

    async handleVoiceChatMessage(discordId: string): Promise<void> {
        await Participant.updateOne(
            { workshopId: this.workshopId, discordId },
            { $inc: { voiceChatMessages: 1 } }
        );
    }

    async handleMemberChatMessage(discordId: string): Promise<void> {
        await Participant.updateOne(
            { workshopId: this.workshopId, discordId },
            { $inc: { memberChatMessages: 1 } }
        );
    }

    isTracking(discordId: string): boolean {
        return this.memberState.has(discordId);
    }

    get trackedCount(): number {
        return this.memberState.size;
    }

    async finalizeAll(): Promise<void> {
        const now = new Date();

        await Promise.allSettled(Array.from(this.memberLocks.values()));

        const stayedMembers = new Set(this.memberState.keys());

        const allParticipants = await Participant.find({ workshopId: this.workshopId });

        for (const participant of allParticipants) {
            let changed = false;

            if (stayedMembers.has(participant.discordId)) {
                participant.stayedUntilEnd = true;
                changed = true;
            }

            for (const session of participant.voiceSessions) {
                if (!session.leaveTime) {
                    session.leaveTime = now;
                    session.duration = now.getTime() - session.joinTime.getTime();
                    changed = true;
                }
            }

            for (const mic of participant.micActivity) {
                if (!mic.mutedAt) {
                    mic.mutedAt = now;
                    mic.duration = now.getTime() - mic.unmutedAt.getTime();
                    changed = true;
                }
            }

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

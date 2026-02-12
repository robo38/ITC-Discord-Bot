import { Events, Message, ChannelType } from "discord.js";
import { getAllActiveTrackers } from "../workshop";
import teamsData from "../data";

export default {
    name: Events.MessageCreate,
    async execute(message: Message) {
        if (message.author.bot) return;

        const trackers = getAllActiveTrackers();
        if (trackers.size === 0) return;

        const channelId = message.channelId;

        for (const [workshopId, tracker] of trackers) {
            const teamConfig = tracker.teamConfig;

            // Check if the message is in the voice channel's text chat
            // Voice channels have a built-in text chat with the same ID
            if (channelId === teamConfig.voiceChannelID) {
                if (tracker.isTracking(message.author.id)) {
                    await tracker.handleVoiceChatMessage(message.author.id);
                }
                continue;
            }

            // Check if the message is in the leader's chat channel (member chat)
            if (channelId === teamConfig.LeaderChatChannelID) {
                // Track messages from anyone in this workshop
                await tracker.handleMemberChatMessage(message.author.id);
                continue;
            }
        }
    },
};

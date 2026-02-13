import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface ISplitConfig {
    botToken1: string;
    botToken2: string;
    voiceChannelId1: string;
    voiceChannelId2: string;
    specialRoleId?: string; // optional role specific to this split
}

export interface IBotConfig {
    teamName: string;
    leaderRoleId: string;
    membersRoleId: string;
    additionalMembersRoleId?: string;
    isSplit: boolean;
    splitConfig?: ISplitConfig;
    // Non-split fields (used when isSplit=false)
    botToken?: string;
    botId?: string;
    voiceChannelId?: string;
    leaderChatChannelId: string;
    generalAnnChannelId: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const splitConfigSchema = new Schema<ISplitConfig>(
    {
        botToken1: { type: String, required: true },
        botToken2: { type: String, required: true },
        voiceChannelId1: { type: String, required: true },
        voiceChannelId2: { type: String, required: true },
        specialRoleId: { type: String, default: "" },
    },
    { _id: false }
);

const botConfigSchema = new Schema<IBotConfig>(
    {
        teamName: { type: String, required: true, unique: true },
        leaderRoleId: { type: String, default: "" },
        membersRoleId: { type: String, default: "" },
        additionalMembersRoleId: { type: String, default: "" },
        isSplit: { type: Boolean, default: false },
        splitConfig: { type: splitConfigSchema, default: undefined },
        botToken: { type: String, default: "" },
        botId: { type: String, default: "" },
        voiceChannelId: { type: String, default: "" },
        leaderChatChannelId: { type: String, default: "" },
        generalAnnChannelId: { type: String, default: "" },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

export const BotConfig = model<IBotConfig>("BotConfig", botConfigSchema);

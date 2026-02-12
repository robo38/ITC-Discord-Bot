import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface IVoiceSession {
    joinTime: Date;
    leaveTime?: Date;
    duration: number; // ms
}

export interface IMicActivity {
    unmutedAt: Date;
    mutedAt?: Date;
    duration: number; // ms
}

export interface IDeafenActivity {
    deafenedAt: Date;
    undeafenedAt?: Date;
    duration: number; // ms
}

export interface IParticipant {
    workshopId: string;
    discordId: string;
    username: string;
    teamLabel: "First team" | "Second team" | "Unknown";
    voiceSessions: IVoiceSession[];
    micActivity: IMicActivity[];
    deafenActivity: IDeafenActivity[];
    voiceChatMessages: number;
    memberChatMessages: number;
    stayedUntilEnd: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const voiceSessionSchema = new Schema<IVoiceSession>(
    {
        joinTime: { type: Date, required: true },
        leaveTime: { type: Date },
        duration: { type: Number, default: 0 },
    },
    { _id: false }
);

const micActivitySchema = new Schema<IMicActivity>(
    {
        unmutedAt: { type: Date, required: true },
        mutedAt: { type: Date },
        duration: { type: Number, default: 0 },
    },
    { _id: false }
);

const deafenActivitySchema = new Schema<IDeafenActivity>(
    {
        deafenedAt: { type: Date, required: true },
        undeafenedAt: { type: Date },
        duration: { type: Number, default: 0 },
    },
    { _id: false }
);

const participantSchema = new Schema<IParticipant>(
    {
        workshopId: { type: String, required: true, index: true },
        discordId: { type: String, required: true },
        username: { type: String, required: true },
        teamLabel: {
            type: String,
            enum: ["First team", "Second team", "Unknown"],
            default: "Unknown",
        },
        voiceSessions: { type: [voiceSessionSchema], default: [] },
        micActivity: { type: [micActivitySchema], default: [] },
        deafenActivity: { type: [deafenActivitySchema], default: [] },
        voiceChatMessages: { type: Number, default: 0 },
        memberChatMessages: { type: Number, default: 0 },
        stayedUntilEnd: { type: Boolean, default: false },
    },
    { timestamps: true }
);

participantSchema.index({ workshopId: 1, discordId: 1 }, { unique: true });

export const Participant = model<IParticipant>("Participant", participantSchema);

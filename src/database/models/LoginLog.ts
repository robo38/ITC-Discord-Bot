import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface ILoginLog {
    discordId: string;
    username: string;
    globalName: string;
    avatarUrl: string;
    role: string;
    timestamp: Date;
}

const loginLogSchema = new Schema<ILoginLog>(
    {
        discordId: { type: String, required: true, index: true },
        username: { type: String, required: true },
        globalName: { type: String, required: true },
        avatarUrl: { type: String, default: "" },
        role: { type: String, required: true },
        timestamp: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

// Auto-expire after 30 days
loginLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const LoginLog = model<ILoginLog>("LoginLog", loginLogSchema);

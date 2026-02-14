import { mongoose } from "../connection";

const { Schema, model } = mongoose;

export interface IWhitelist {
    discordId: string;
    addedBy: string; // dev's discordId who added this user
    addedAt: Date;
}

const whitelistSchema = new Schema<IWhitelist>(
    {
        discordId: { type: String, required: true, unique: true },
        addedBy: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

export const Whitelist = model<IWhitelist>("Whitelist", whitelistSchema);

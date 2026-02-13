import mongoose from "mongoose";
import { logDatabase, logError } from "../utils/logger";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/itcb";

let isConnected = false;

export async function connectDB(): Promise<void> {
    if (isConnected) return;

    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        logDatabase("MongoDB Connected", MONGO_URI.replace(/\/\/.*@/, "//<credentials>@"));
    } catch (error: any) {
        logError("MongoDB Connection Failed", error);
        throw error;
    }

    mongoose.connection.on("error", (err) => {
        logError("MongoDB Runtime Error", err);
    });

    mongoose.connection.on("disconnected", () => {
        isConnected = false;
        logDatabase("MongoDB Disconnected", "Connection lost");
    });
}

export { mongoose };

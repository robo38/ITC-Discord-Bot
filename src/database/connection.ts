import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/itcb";

let isConnected = false;

export async function connectDB(): Promise<void> {
    if (isConnected) return;

    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        console.log("[MongoDB] Connected successfully");
    } catch (error) {
        console.error("[MongoDB] Connection error:", error);
        throw error;
    }
}

export { mongoose };

// src/types/env.d.ts

declare namespace NodeJS {
    interface ProcessEnv {
        PORT: number;
        CHANNEL_URL: string;
        BOT_TOKEN: string;
        BOT_CHAT_ID: string;
    }
}
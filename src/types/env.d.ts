// src/types/env.d.ts

declare namespace NodeJS {
    interface ProcessEnv {
        PORT: number;
        CHANNEL_URL: string;
    }
}
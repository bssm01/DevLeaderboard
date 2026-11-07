import dotenv from "dotenv";
import path from "node:path";
import { applyDefaults } from "./default.js";
import { Config } from "./schema.js";

export function loadConfig(): Config {
    dotenv.config({ path: path.resolve(process.cwd(), "src/config/.env") });
    applyDefaults();

    return {
        Database: {
            Host: process.env.DATABASE_HOST as string,
            Port: parseInt(process.env.DATABASE_PORT as string, 10),
            User: process.env.DATABASE_USER as string,
            Password: process.env.DATABASE_PASSWORD as string,
            Name: process.env.DATABASE_NAME as string,
        },
    };
}

export const config = loadConfig();

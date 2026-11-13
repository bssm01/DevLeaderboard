import mongoose from "mongoose";
import { config } from "../../../config/config.js";
import type { DatabaseConfig } from "../../../config/schema.js";
import { logger } from "../../../lib/logger.js";

/**
 * Builds the connection string from the discrete fields. `DATABASE_URL`
 * (when set) wins outright and bypasses this entirely.
 *
 * `mongodb+srv` URIs must not carry an explicit port — SRV records publish
 * their own — so the port is only appended for the `mongodb` scheme.
 */
export const buildMongoUrl = (database: DatabaseConfig): string => {
    if (database.Url !== undefined) return database.Url;

    // Credentials may contain characters that are illegal in a URL (@, :, /).
    const credentials =
        database.User && database.Password
            ? `${encodeURIComponent(database.User)}:${encodeURIComponent(database.Password)}@`
            : "";
    const host =
        database.Scheme === "mongodb+srv" ? database.Host : `${database.Host}:${database.Port}`;

    return `${database.Scheme}://${credentials}${host}/${database.Name}`;
};

/**
 * A log-safe description of the target: hostname + database name only.
 * The raw URL is never logged because it embeds the password.
 */
export const describeMongoTarget = (
    database: DatabaseConfig,
): { host: string; name: string } => {
    if (database.Url === undefined) {
        return { host: database.Host, name: database.Name };
    }

    try {
        const parsed = new URL(database.Url);
        const name = parsed.pathname.replace(/^\//, "").split("/")[0];
        return { host: parsed.hostname, name: name.length > 0 ? name : "(default)" };
    } catch {
        // Schema already validates the scheme, so this is a belt-and-braces
        // guard: logging must never throw, even on a mangled URL.
        return { host: "(unparsable DATABASE_URL)", name: database.Name };
    }
};

export const connectDB = async (): Promise<void> => {
    const { Url } = config.Database;
    const dbUrl = buildMongoUrl(config.Database);
    const target = describeMongoTarget(config.Database);
    const mode = Url !== undefined ? "url" : "fields";

    try {
        // Fail fast instead of waiting the default 30s for server selection.
        await mongoose.connect(dbUrl, { serverSelectionTimeoutMS: 5000 });
        logger.info("mongodb connected", { ...target, mode });
    } catch (error) {
        logger.error("mongodb connection failed", { ...target, mode, err: error });
        process.exit(1);
    }
};

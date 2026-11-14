import mongoose from "mongoose";
import app from "./app.js";
import { config } from "./config/config.js";
import { connectDB } from "./infra/db/config/connectionDB.js";
import { startRefreshCron, stopRefreshCron } from "./jobs/refreshCron.js";
import { logger } from "./lib/logger.js";

await connectDB();

const server = app.listen(config.Port, () => {
    logger.info("server started", { port: config.Port });
});

// Only the long-lived process owns the scheduler: tests import `app` directly.
startRefreshCron();

const shutdown = (signal: NodeJS.Signals): void => {
    logger.info("shutdown requested", { signal });
    stopRefreshCron();

    server.close(() => {
        void mongoose
            .disconnect()
            .catch(() => undefined)
            .finally(() => process.exit(0));
    });
    // Force exit if open connections keep the server alive.
    setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

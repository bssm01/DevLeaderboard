import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config/config.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requestLog } from "./middleware/requestLog.js";
import authRoutes from "./routes/authRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";

const app = express();

app.use(helmet());
app.use(express.json());
// Structured access log; LOG_LEVEL=warn silences it in tests.
app.use(requestLog);

const authLimiter = rateLimit({
    windowMs: config.RateLimit.WindowMs,
    limit: config.RateLimit.Max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.use("/auth", authLimiter, authRoutes);
app.use("/leaderboard", leaderboardRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;

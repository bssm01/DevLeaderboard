import rateLimit from "express-rate-limit";
import express from "express";
import { config } from "../config/config.js";
import {
    getLeaderboard,
    getLeaderboardMeta,
    refreshLeaderboard,
} from "../controllers/leaderboardCtrl.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

// Reads are cacheable and cheap (Mongo only); refreshes spend GitHub quota,
// so they get a much tighter bucket than the public GETs.
const refreshLimiter = rateLimit({
    windowMs: config.RateLimit.RefreshWindowMs,
    limit: config.RateLimit.RefreshMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many refresh requests, please try again later" },
});

router.get("/:org/meta", getLeaderboardMeta);
router.get("/:org", getLeaderboard);
router.post("/:org/refresh", refreshLimiter, requireAuth, refreshLeaderboard);

export default router;

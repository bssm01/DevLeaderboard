import mongoose from "mongoose";
import { PERIODS, type Period } from "../services/leaderboard/periods.js";
import type { SnapshotContributor } from "../services/leaderboard/types.js";

export interface LeaderboardSnapshotAttrs {
    /** Lowercased: GitHub org logins are case-insensitive and the API looks up by index. */
    orgLogin: string;
    period: Period;
    windowFrom: Date;
    windowTo: Date;
    generatedAt: Date;
    contributors: SnapshotContributor[];
    warnings: string[];
    createdAt?: Date;
    updatedAt?: Date;
}

export type SnapshotInput = Omit<LeaderboardSnapshotAttrs, "createdAt" | "updatedAt">;

const snapshotContributorSchema = new mongoose.Schema<SnapshotContributor>(
    {
        key: { type: String, required: true },
        login: { type: String, required: true },
        avatarUrl: { type: String, default: "" },
        commits: { type: Number, required: true },
        pullRequests: { type: Number, required: true },
        reviews: { type: Number, required: true },
        issues: { type: Number, required: true },
        score: { type: Number, required: true },
        rank: { type: Number, required: true },
    },
    { _id: false },
);

const leaderboardSnapshotSchema = new mongoose.Schema<LeaderboardSnapshotAttrs>(
    {
        orgLogin: { type: String, required: true, lowercase: true, trim: true },
        period: { type: String, required: true, enum: PERIODS },
        windowFrom: { type: Date, required: true },
        windowTo: { type: Date, required: true },
        generatedAt: { type: Date, required: true },
        contributors: { type: [snapshotContributorSchema], default: [] },
        warnings: { type: [String], default: [] },
    },
    { timestamps: true },
);

// One snapshot per org+period: refreshes overwrite in place.
leaderboardSnapshotSchema.index({ orgLogin: 1, period: 1 }, { unique: true });

const LeaderboardSnapshot = mongoose.model<LeaderboardSnapshotAttrs>(
    "LeaderboardSnapshot",
    leaderboardSnapshotSchema,
);

export const upsertSnapshot = async (input: SnapshotInput): Promise<void> => {
    await LeaderboardSnapshot.findOneAndUpdate(
        { orgLogin: input.orgLogin.toLowerCase(), period: input.period },
        {
            $set: {
                windowFrom: input.windowFrom,
                windowTo: input.windowTo,
                generatedAt: input.generatedAt,
                contributors: input.contributors,
                warnings: input.warnings,
            },
        },
        { upsert: true, setDefaultsOnInsert: true },
    );
};

/** Lightweight projection used by the meta endpoint (no contributor payloads). */
export interface SnapshotSummary {
    period: Period;
    generatedAt: Date;
    entryCount: number;
}

/** Read path: a single org+period snapshot, lowercased for the unique index. */
export const findSnapshot = async (
    orgLogin: string,
    period: Period,
): Promise<LeaderboardSnapshotAttrs | null> =>
    (await LeaderboardSnapshot.findOne({
        orgLogin: orgLogin.toLowerCase(),
        period,
    }).lean()) as LeaderboardSnapshotAttrs | null;

/** Read path: which periods an org has, and how fresh each one is. */
export const findSnapshotSummaries = async (orgLogin: string): Promise<SnapshotSummary[]> =>
    LeaderboardSnapshot.aggregate<SnapshotSummary>([
        { $match: { orgLogin: orgLogin.toLowerCase() } },
        {
            $project: {
                _id: 0,
                period: 1,
                generatedAt: 1,
                entryCount: { $size: { $ifNull: ["$contributors", []] } },
            },
        },
    ]);

export default LeaderboardSnapshot;

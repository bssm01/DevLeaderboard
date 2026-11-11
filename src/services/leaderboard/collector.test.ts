import { describe, expect, it, vi } from "vitest";
import { GitHubError } from "../github/errors.js";
import { collectContributions, type CollectorClient } from "./collector.js";
import { windowFor } from "./periods.js";

const WINDOW = windowFor("30d", new Date("2026-11-11T00:00:00.000Z"));

/** Wire-shaped fixtures: exactly what GitHub's GraphQL API returns. */
const userNode = (n: number) => ({
    id: `node-${n}`,
    login: `user${n}`,
    avatarUrl: `https://avatars.example/${n}.png`,
});

const nodesPage = <T>(nodes: T[], hasNextPage = false, endCursor: string | null = null) => ({
    pageInfo: { hasNextPage, endCursor },
    nodes,
});

interface RestCollaborator {
    id: number;
    login: string;
    avatar_url: string;
}

interface FakeOptions {
    members?: (cursor: string | null) => { organization: unknown };
    /** Omit to simulate the 403 most tokens get for listing collaborators. */
    outsideCollaborators?: RestCollaborator[];
    contributions?: (variables: Record<string, unknown>) => Record<string, unknown>;
}

interface FakeGithub {
    client: CollectorClient;
    calls: Array<{ query: string; variables?: Record<string, unknown> }>;
}

const fakeGithub = (options: FakeOptions): FakeGithub => {
    const calls: FakeGithub["calls"] = [];

    const client: CollectorClient = {
        graphql: async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
            calls.push({ query, variables });

            if (query.includes("membersWithRole")) {
                if (options.members === undefined) throw new Error("members handler not configured");
                return options.members((variables?.cursor as string | null) ?? null) as T;
            }

            if (query.includes("contributionsCollection")) {
                if (options.contributions === undefined) throw new Error("contributions handler not configured");
                return options.contributions(variables ?? {}) as T;
            }

            throw new Error("unexpected query in test");
        },
        paginateRest: async function* <T,>(): AsyncGenerator<T, void, undefined> {
            calls.push({ query: "REST outside_collaborators", variables: undefined });
            if (options.outsideCollaborators === undefined) {
                throw new GitHubError(
                    "GitHub API error 403: You must be an owner of this organization to list outside collaborators.",
                    403,
                );
            }
            yield* options.outsideCollaborators as unknown as T[];
        },
    };

    return { client, calls };
};

/** Builds a contributions response for whatever logins the collector batched. */
const contributionsFor = (totals: Record<string, Partial<{ c: number; p: number; r: number; i: number }>> = {}) =>
    (variables: Record<string, unknown>): Record<string, unknown> => {
        const response: Record<string, unknown> = {};
        for (let index = 0; variables[`l${index}`] !== undefined; index += 1) {
            const login = variables[`l${index}`] as string;
            const t = totals[login] ?? {};
            response[`u${index}`] = {
                id: `node-${login}`,
                login,
                avatarUrl: `https://avatars.example/${login}.png`,
                contributionsCollection: {
                    totalCommitContributions: t.c ?? 1,
                    totalPullRequestContributions: t.p ?? 0,
                    totalPullRequestReviewContributions: t.r ?? 0,
                    totalIssueContributions: t.i ?? 0,
                },
            };
        }
        return response;
    };

describe("collectContributions", () => {
    it("collects members across pages plus outside collaborators", async () => {
        const { client, calls } = fakeGithub({
            members: (cursor) => ({
                organization:
                    cursor === null
                        ? {
                              id: "org-node",
                              login: "acme",
                              membersWithRole: nodesPage([userNode(1), userNode(2)], true, "cursor-1"),
                          }
                        : {
                              id: "org-node",
                              login: "acme",
                              membersWithRole: nodesPage([userNode(3)]),
                          },
            }),
            outsideCollaborators: [{ id: 41, login: "user4", avatar_url: "https://avatars.example/4.png" }],
            contributions: contributionsFor(),
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toHaveLength(4);
        expect(result.warnings).toEqual([]);
        // 2 member pages + 1 REST collaborator call + 1 batch (4 users ≤ 10)
        expect(calls).toHaveLength(4);
    });

    it("scopes contributions to the org node ID and the requested window", async () => {
        const { client, calls } = fakeGithub({
            members: () => ({
                organization: {
                    id: "REAL-ORG-NODE",
                    login: "acme",
                    membersWithRole: nodesPage([userNode(1)]),
                },
            }),
            contributions: contributionsFor(),
        });

        await collectContributions("acme", WINDOW, client);

        const contributionCall = calls.find((call) => call.query.includes("contributionsCollection"));
        expect(contributionCall?.variables?.orgId).toBe("REAL-ORG-NODE");
        expect(contributionCall?.variables?.from).toBe(WINDOW.from.toISOString());
        expect(contributionCall?.variables?.to).toBe(WINDOW.to.toISOString());
    });

    it("never interpolates logins into the query string (variables only)", async () => {
        const { client, calls } = fakeGithub({
            members: () => ({
                organization: {
                    id: "org-node",
                    login: "acme",
                    membersWithRole: nodesPage([{ id: "node-x", login: 'evil" } { hack }', avatarUrl: "" }]),
                },
            }),
            contributions: contributionsFor(),
        });

        await collectContributions("acme", WINDOW, client);

        const contributionCall = calls.find((call) => call.query.includes("contributionsCollection"));
        expect(contributionCall?.query).not.toContain("evil");
        expect(contributionCall?.query).toContain("$l0: String!");
        expect(contributionCall?.variables?.l0).toBe('evil" } { hack }');
    });

    it("fails with 404 when the organization does not exist", async () => {
        const { client } = fakeGithub({ members: () => ({ organization: null }) });

        const error = await collectContributions("nope", WINDOW, client).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).status).toBe(404);
        expect((error as GitHubError).message).toContain("Organization not found");
    });

    it("degrades to a warning when outside collaborators are forbidden", async () => {
        const { client } = fakeGithub({
            members: () => ({
                organization: {
                    id: "org-node",
                    login: "acme",
                    membersWithRole: nodesPage([userNode(1)]),
                },
            }),
            contributions: contributionsFor(),
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toHaveLength(1);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain("Outside collaborators unavailable");
        expect(result.warnings[0]).toContain("403");
    });

    it("batches at 10 users per request", async () => {
        const users = Array.from({ length: 25 }, (_, index) => userNode(index));
        const { client, calls } = fakeGithub({
            members: () => ({
                organization: { id: "org-node", login: "acme", membersWithRole: nodesPage(users) },
            }),
            contributions: contributionsFor(),
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toHaveLength(25);
        const contributionCalls = calls.filter((call) => call.query.includes("contributionsCollection"));
        expect(contributionCalls).toHaveLength(3); // 10 + 10 + 5
        expect(contributionCalls[0].variables?.l9).toBeDefined();
        expect(contributionCalls[2].variables?.l0).toBeDefined();
        expect(contributionCalls[2].variables?.l9).toBeUndefined();
    });

    it("skips deleted users with a warning instead of failing the run", async () => {
        const { client } = fakeGithub({
            members: () => ({
                organization: {
                    id: "org-node",
                    login: "acme",
                    membersWithRole: nodesPage([userNode(1), { id: "node-2", login: "ghost", avatarUrl: "" }]),
                },
            }),
            outsideCollaborators: [],
            contributions: (variables) => {
                const response = contributionsFor()(variables);
                delete response.u1; // GitHub: account gone
                return response;
            },
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toHaveLength(1);
        expect(result.contributors[0].login).toBe("user1");
        expect(result.warnings[0]).toContain("ghost");
    });

    it("treats missing contribution data as zeros with a warning", async () => {
        const { client } = fakeGithub({
            members: () => ({
                organization: {
                    id: "org-node",
                    login: "acme",
                    membersWithRole: nodesPage([userNode(1)]),
                },
            }),
            outsideCollaborators: [],
            contributions: (variables) => {
                const response = contributionsFor()(variables) as Record<string, Record<string, unknown>>;
                (response.u0 as Record<string, unknown>).contributionsCollection = null;
                return response;
            },
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors[0]).toMatchObject({ commits: 0, pullRequests: 0, reviews: 0, issues: 0 });
        expect(result.warnings[0]).toContain("No contribution data");
    });

    it("never counts the same login twice across members and collaborators", async () => {
        const { client } = fakeGithub({
            members: () => ({
                organization: {
                    id: "org-node",
                    login: "acme",
                    membersWithRole: nodesPage([userNode(1)]),
                },
            }),
            // Same person, different source: numeric REST id vs GraphQL node id.
            outsideCollaborators: [{ id: 99, login: "user1", avatar_url: "" }],
            contributions: contributionsFor(),
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toHaveLength(1);
        expect(result.contributors[0].login).toBe("user1");
    });

    it("returns an empty list for an organization with no members", async () => {
        const { client, calls } = fakeGithub({
            members: () => ({
                organization: { id: "org-node", login: "acme", membersWithRole: nodesPage([]) },
            }),
        });

        const result = await collectContributions("acme", WINDOW, client);

        expect(result.contributors).toEqual([]);
        expect(calls.some((call) => call.query.includes("contributionsCollection"))).toBe(false);
    });

    it("propagates a hard failure from the members query", async () => {
        const client: CollectorClient = {
            graphql: vi.fn(async () => {
                throw new GitHubError("GitHub API error 502: Bad Gateway", 502);
            }),
            paginateRest: async function* <T,>(): AsyncGenerator<T, void, undefined> {
                // never reached: the members query fails first
            },
        };

        await expect(collectContributions("acme", WINDOW, client)).rejects.toThrow("502");
    });
});

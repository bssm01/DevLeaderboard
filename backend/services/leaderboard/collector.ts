import { GitHubError } from "../github/errors.js";
import { githubClient } from "../github/githubClient.js";
import { drain, paginateGraphql } from "../github/pagination.js";
import type { GraphqlPage } from "../github/types.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { isBotLogin } from "./aggregator.js";
import {
    resolveWindow,
    splitWindow,
    type CustomRange,
    type Period,
    type TimeWindow,
} from "./periods.js";
import type { CollectResult, RawContributor } from "./types.js";

/** Users per GraphQL request. Keeps query complexity (and cost) predictable. */
const BATCH_SIZE = 10;

/**
 * GitHub allows plenty of parallelism; these caps keep the refresh fast
 * without tripping secondary rate limits.
 */
const REPO_CONCURRENCY = 5;
const CONTRIBUTION_CONCURRENCY = 4;
const SCAN_REPO_CONCURRENCY = 3;
const BRANCH_CONCURRENCY = 4;

const ORG_MEMBERS_QUERY = `
query ($login: String!, $cursor: String) {
  organization(login: $login) {
    id
    login
    createdAt
    membersWithRole(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id login avatarUrl }
    }
  }
}`;

/**
 * Identity-only query. Unlike `membersWithRole`, this is readable by any
 * token that can see the organization — including fine-grained tokens that
 * have not been approved for the org.
 */
const ORG_IDENTITY_QUERY = `
query ($login: String!) {
  organization(login: $login) {
    id
    login
    createdAt
  }
}`;

/**
 * Aliased batch: one request pulls identity + contributions for up to
 * BATCH_SIZE users. Logins travel as variables ($l0, $l1, ...) — never
 * interpolated into the query string — so no escaping rules to get wrong.
 */
const buildContributionsQuery = (batchSize: number): string => {
    const variableDefs = Array.from({ length: batchSize }, (_, index) => `$l${index}: String!`).join(", ");
    const fields = Array.from(
        { length: batchSize },
        (_, index) => `u${index}: user(login: $l${index}) {
      id
      login
      avatarUrl
      contributionsCollection(organizationID: $orgId, from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
      }
    }`,
    ).join("\n");

    return `query ($orgId: ID!, $from: DateTime!, $to: DateTime!, ${variableDefs}) {\n${fields}\n}`;
};

interface UserNode {
    id: string;
    login: string;
    avatarUrl: string;
}

interface OrgNode {
    id: string;
    login: string;
    createdAt: string;
}

interface ContributionsCollection {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalIssueContributions: number;
}

interface BatchUser {
    id: string;
    login: string;
    avatarUrl: string;
    contributionsCollection: ContributionsCollection | null;
}

type BatchResponse = Record<string, BatchUser | null>;

interface OrgMembersResponse {
    organization:
        | {
              id: string;
              login: string;
              createdAt: string;
              membersWithRole: NodesPage<UserNode>;
          }
        | null;
}

interface OrgIdentityResponse {
    organization: OrgNode | null;
}

interface OutsideCollaboratorRest {
    id: number;
    node_id?: string;
    login: string;
    avatar_url: string;
}

interface RepoRest {
    full_name: string;
    fork: boolean;
    private: boolean;
    default_branch: string;
    /**
     * An explicitly allowed project outside the organization. GraphQL's
     * organization-scoped contribution graph never counts these, so their
     * activity is always read directly.
     */
    external?: boolean;
}

interface ExtraRepoNode {
    nameWithOwner: string;
    isPrivate: boolean;
    isFork: boolean;
    defaultBranchRef: { name: string } | null;
}

interface ExtraRepoResponse {
    repository: ExtraRepoNode | null;
}

const EXTRA_REPO_QUERY = `
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    isPrivate
    isFork
    defaultBranchRef { name }
  }
}`;

/** What GraphQL actually sends over the wire for a connection field. */
interface NodesPage<T> {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: T[];
}

/** GraphQL returns `nodes`; paginateGraphql consumes `items`. */
const asItemsPage = <T>(page: NodesPage<T>): GraphqlPage<T> => ({
    items: page.nodes,
    pageInfo: page.pageInfo,
});

/** The subset of the client the collector needs — trivial to fake in tests. */
export interface CollectorClient {
    graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
    paginateRest: <T>(path: string) => AsyncGenerator<T, void, undefined>;
    /** Optional so existing fakes stay valid; absent means "no scope header". */
    getScopes?: () => Promise<string[] | undefined>;
}

/** Which API produced the member list — surfaced only in logs. */
export type MemberSource = "membersWithRole" | "fallback";

interface OrgWithMembers {
    id: string;
    login: string;
    createdAt: Date;
    members: UserNode[];
    memberSource: MemberSource;
    /** Every repository the token can see, forks included. */
    repos: RepoRest[];
}

const requireOrg = <T>(organization: T | null | undefined, orgLogin: string): T => {
    if (organization === null || organization === undefined) {
        throw new GitHubError(`Organization not found: ${orgLogin}`, 404);
    }
    return organization;
};

/**
 * GitHub refuses `membersWithRole` to tokens that cannot see org membership:
 * a fine-grained PAT that was never approved by the org, or a classic token
 * without `read:org`. Those tokens can still read the public profile and the
 * public member list, which is enough for a public leaderboard.
 */
const isPermissionError = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 403 ||
        error.type === "FORBIDDEN" ||
        error.type === "INSUFFICIENT_SCOPES" ||
        /not accessible|must be an owner|not have permission/i.test(error.message));

/**
 * A repository that cannot be read (permission, missing, or empty) is safe to
 * skip. A rate limit or a network failure must fail the refresh so the
 * previous snapshot stays on screen instead of being replaced by a partial one.
 */
const isUnavailableRepoError = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 403 || error.status === 404 || error.status === 409) &&
    error.rateLimit?.remaining !== 0;

/**
 * GitHub intermittently answers a large branch, commit or review read with a
 * gateway error. The client already retries; if it persists, that one
 * repository is skipped with a warning rather than discarding the whole
 * snapshot. A total outage is still surfaced through the organization-level
 * reads, which do not use this predicate.
 */
const isTransientRepoError = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504);

const isSkippableRepoError = (error: unknown): boolean =>
    isUnavailableRepoError(error) || isTransientRepoError(error);

const errorDetail = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const fetchOrgIdentity = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<OrgNode> => {
    const data = await client.graphql<OrgIdentityResponse>(ORG_IDENTITY_QUERY, { login: orgLogin });
    return requireOrg(data.organization, orgLogin);
};

const fetchMembersWithRole = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<{ org: OrgNode; members: UserNode[] }> => {
    let org: OrgNode | undefined;

    const memberPages = async (cursor: string | null): Promise<GraphqlPage<UserNode>> => {
        const data = await client.graphql<OrgMembersResponse>(ORG_MEMBERS_QUERY, {
            login: orgLogin,
            cursor,
        });
        const organization = requireOrg(data.organization, orgLogin);
        org ??= {
            id: organization.id,
            login: organization.login,
            createdAt: organization.createdAt,
        };
        return asItemsPage(organization.membersWithRole);
    };

    const members = await drain(paginateGraphql(memberPages));
    if (org === undefined) {
        // Unreachable: the generator always fetches at least one page.
        throw new GitHubError(`GitHub returned no organization for ${orgLogin}`, 404);
    }

    return { org, members };
};

/** Public members are readable without org membership; paginated like any REST list. */
const fetchPublicMembers = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<UserNode[]> => {
    const path = `/orgs/${encodeURIComponent(orgLogin)}/public_members?per_page=100`;
    const members: UserNode[] = [];

    for await (const member of client.paginateRest<OutsideCollaboratorRest>(path)) {
        if (member.login === undefined || member.login.length === 0) continue;
        members.push({
            id: member.node_id ?? String(member.id),
            login: member.login,
            avatarUrl: member.avatar_url ?? "",
        });
    }

    return members;
};

/**
 * Every repository the token can see, private ones included. A forbidden or
 * missing repository list degrades to an empty list; rate limits and network
 * failures propagate so a partial snapshot is never cached.
 */
const fetchOrgRepos = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<RepoRest[]> => {
    const reposPath = `/orgs/${encodeURIComponent(orgLogin)}/repos?per_page=100&type=all`;
    try {
        return await drain(client.paginateRest<RepoRest>(reposPath));
    } catch (error) {
        // Only a permission or missing-org answer may degrade: an empty list
        // would silently erase the whole board.
        if (isUnavailableRepoError(error)) return [];
        throw error;
    }
};

/**
 * Contributors of every repository in the org. Without `read:org` this is the
 * most complete contributor list available: it includes people whose org
 * membership is private, which the public member list misses entirely.
 */
const fetchRepoContributors = async (
    repos: RepoRest[],
    client: CollectorClient,
): Promise<UserNode[]> => {
    // Forks are copies of someone else's history; their contributors are not
    // necessarily contributors to this organization.
    const sources = repos.filter((repo) => !repo.fork);

    const lists = await mapWithConcurrency(sources, REPO_CONCURRENCY, async (repo) => {
        try {
            const path = `/repos/${repo.full_name}/contributors?per_page=100`;
            return await drain(client.paginateRest<OutsideCollaboratorRest>(path));
        } catch (error) {
            // One inaccessible or empty repository must not fail the whole run.
            if (isSkippableRepoError(error)) return [];
            throw error;
        }
    });

    const users: UserNode[] = [];
    for (const contributor of lists.flat()) {
        if (contributor.login === undefined || contributor.login.length === 0) continue;
        users.push({
            id: contributor.node_id ?? String(contributor.id),
            login: contributor.login,
            avatarUrl: contributor.avatar_url ?? "",
        });
    }

    return users;
};

/**
 * Resolves explicitly allowed projects outside the organization. They are
 * marked `external` so the scan reads every metric directly: GraphQL's
 * organization-scoped contribution graph cannot see them.
 */
const fetchExtraRepos = async (
    fullNames: readonly string[],
    client: CollectorClient,
    warnings: string[],
): Promise<RepoRest[]> => {
    const results = await mapWithConcurrency(
        fullNames,
        REPO_CONCURRENCY,
        async (fullName): Promise<RepoRest | null> => {
            const slash = fullName.indexOf("/");
            if (slash <= 0 || slash === fullName.length - 1) {
                warnings.push(`Ignored extra repository "${fullName}": expected owner/repo`);
                return null;
            }

            const owner = fullName.slice(0, slash);
            const name = fullName.slice(slash + 1);

            try {
                const data = await client.graphql<ExtraRepoResponse>(EXTRA_REPO_QUERY, {
                    owner,
                    name,
                });
                const repo = data.repository;
                if (repo === null) {
                    warnings.push(`Extra repository not found: ${fullName}`);
                    return null;
                }

                return {
                    full_name: repo.nameWithOwner,
                    fork: repo.isFork,
                    private: repo.isPrivate,
                    default_branch: repo.defaultBranchRef?.name ?? "main",
                    external: true,
                };
            } catch (error) {
                if (isSkippableRepoError(error)) {
                    warnings.push(
                        `Could not read extra repository ${fullName}: ${errorDetail(error)}`,
                    );
                    return null;
                }
                throw error;
            }
        },
    );

    return results.filter((repo): repo is RepoRest => repo !== null);
};

/** Organization repos win when an extra repo is also owned by the org. */
const mergeRepos = (orgRepos: RepoRest[], extraRepos: RepoRest[]): RepoRest[] => {
    const merged = [...orgRepos];
    const seen = new Set(orgRepos.map((repo) => repo.full_name.toLowerCase()));

    for (const repo of extraRepos) {
        const key = repo.full_name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(repo);
    }

    return merged;
};

const toOrgDate = (value: string, orgLogin: string): Date => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new GitHubError(`GitHub returned an invalid creation date for ${orgLogin}`, 502);
    }
    return date;
};

/**
 * Resolves the org and its members, degrading from the full member list to
 * public members when the token is not allowed to see membership.
 */
const fetchOrgWithMembers = async (
    orgLogin: string,
    client: CollectorClient,
    extraRepos: readonly string[] = [],
    warnings: string[] = [],
): Promise<OrgWithMembers> => {
    let memberResult: { org: OrgNode; members: UserNode[] };

    try {
        memberResult = await fetchMembersWithRole(orgLogin, client);
    } catch (error) {
        if (!isPermissionError(error)) throw error;

        // Fine-grained tokens that are not approved for the org can read the
        // public profile, the public member list and every public repository.
        // Union both sources so private members are not silently dropped.
        const org = await fetchOrgIdentity(orgLogin, client);
        const [publicMembers, orgRepos] = await Promise.all([
            fetchPublicMembers(orgLogin, client),
            fetchOrgRepos(orgLogin, client),
        ]);
        const extras = await fetchExtraRepos(extraRepos, client, warnings);
        const repos = mergeRepos(orgRepos, extras);
        const repoContributors = await fetchRepoContributors(repos, client);

        return {
            id: org.id,
            login: org.login,
            createdAt: toOrgDate(org.createdAt, orgLogin),
            members: [...publicMembers, ...repoContributors],
            memberSource: "fallback",
            repos,
        };
    }

    const { org, members } = memberResult;
    const orgRepos = await fetchOrgRepos(orgLogin, client);
    const extras = await fetchExtraRepos(extraRepos, client, warnings);
    const repos = mergeRepos(orgRepos, extras);

    // The member list alone is not enough: someone can contribute to an
    // organization repository without being a member or an outside
    // collaborator (a one-off PR, a drive-by commit, a bot-owned account).
    // Unioning repository contributors closes that gap for every token,
    // not just the permission-limited fallback above. Private repositories
    // are included automatically when the token can see them.
    const repoContributors = await fetchRepoContributors(repos, client);

    return {
        id: org.id,
        login: org.login,
        createdAt: toOrgDate(org.createdAt, orgLogin),
        members: [...members, ...repoContributors],
        memberSource: "membersWithRole",
        repos,
    };
};

/**
 * GitHub resolves `user(login:)` to null for accounts that no longer exist and
 * rejects bot logins (`dependabot[bot]`) outright. A single bad login must not
 * fail a whole batch, so such errors are retried one user at a time.
 */
const isUnresolvableUser = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 404 ||
        error.type === "NOT_FOUND" ||
        /could not resolve to a user/i.test(error.message));

interface RestUser {
    login: string;
    id: number;
    node_id?: string;
    avatar_url?: string;
}

interface BranchRest {
    name: string;
}

interface CommitRest {
    sha: string;
    author: RestUser | null;
    committer: RestUser | null;
}

interface PullRest {
    number: number;
    user: RestUser | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    merged_at: string | null;
}

interface ReviewRest {
    user: RestUser | null;
    submitted_at: string | null;
}

interface IssueRest {
    number: number;
    user: RestUser | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    closed_by: RestUser | null;
    pull_request?: unknown;
}

const toRestUser = (user: RestUser | null | undefined): UserNode | undefined => {
    if (user === null || user === undefined || user.login.length === 0) return undefined;
    return {
        id: user.node_id ?? String(user.id),
        login: user.login,
        avatarUrl: user.avatar_url ?? "",
    };
};

const commitUser = (commit: CommitRest): UserNode | undefined =>
    toRestUser(commit.author) ?? toRestUser(commit.committer);

const timeOf = (value: string): number => Date.parse(value);

/** Counts attributed to one account during a repository scan. */
interface ActivityCounts {
    user: UserNode;
    commits: number;
    pullRequests: number;
    reviews: number;
    issues: number;
}

type ActivityField = "commits" | "pullRequests" | "reviews" | "issues";

interface ScanResult {
    /** Every account seen in any repository, used to widen the GraphQL batch. */
    users: Map<string, UserNode>;
    /** Activity GraphQL misses: non-default-branch commits, late PR closures, solved issues. */
    publicExtra: Map<string, ActivityCounts>;
    privateExtra: Map<string, ActivityCounts>;
    /** Full activity of private repositories when GraphQL cannot see them. */
    privateFull: Map<string, ActivityCounts>;
    /** Full activity of explicitly allowed repositories outside the org. */
    externalFull: Map<string, ActivityCounts>;
}

interface ScanContext {
    client: CollectorClient;
    window: TimeWindow;
    warnings: string[];
    users: Map<string, UserNode>;
    publicExtra: Map<string, ActivityCounts>;
    privateExtra: Map<string, ActivityCounts>;
    privateFull: Map<string, ActivityCounts>;
    externalFull: Map<string, ActivityCounts>;
    /** Commits reachable from a default/gh-pages branch, already counted by GraphQL. */
    baselineCommits: Set<string>;
    /** Every commit seen in an organization repo, across all branches. */
    orgCommits: Set<string>;
    seenExtraCommits: Set<string>;
    seenFullCommits: Set<string>;
    seenExternalCommits: Set<string>;
    seenExtraPulls: Set<string>;
    seenFullPulls: Set<string>;
    seenFullReviews: Set<string>;
    seenFullIssues: Set<string>;
    seenExtraIssues: Set<string>;
    privateContributionsVisible: boolean;
}

interface RepoPlan {
    repo: RepoRest;
    extraBranches: BranchRest[];
    extra: Map<string, ActivityCounts> | null;
    full: Map<string, ActivityCounts> | null;
}

const activityFor = (
    activity: Map<string, ActivityCounts>,
    user: UserNode,
): ActivityCounts => {
    const key = user.login.toLowerCase();
    const existing = activity.get(key);
    if (existing !== undefined) return existing;

    const created: ActivityCounts = {
        user,
        commits: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
    };
    activity.set(key, created);
    return created;
};

const addActivity = (
    activity: Map<string, ActivityCounts>,
    user: UserNode,
    field: ActivityField,
): void => {
    activityFor(activity, user)[field] += 1;
};

const recordUser = (context: ScanContext, user: UserNode): void => {
    const key = user.login.toLowerCase();
    if (!context.users.has(key)) context.users.set(key, user);
};

const listBranches = async (repo: RepoRest, context: ScanContext): Promise<BranchRest[]> => {
    const path = `/repos/${repo.full_name}/branches?per_page=100`;
    try {
        return await drain(context.client.paginateRest<BranchRest>(path));
    } catch (error) {
        if (!isSkippableRepoError(error)) throw error;
        context.warnings.push(
            `Could not list branches for ${repo.full_name}; using its default branch only`,
        );
        return [{ name: repo.default_branch }];
    }
};

const forEachCommit = async (
    repo: RepoRest,
    branch: string,
    context: ScanContext,
    visit: (commit: CommitRest) => void,
): Promise<void> => {
    const query = new URLSearchParams({
        sha: branch,
        since: context.window.from.toISOString(),
        until: context.window.to.toISOString(),
        per_page: "100",
    });

    try {
        for await (const commit of context.client.paginateRest<CommitRest>(
            `/repos/${repo.full_name}/commits?${query.toString()}`,
        )) {
            visit(commit);
        }
    } catch (error) {
        if (!isSkippableRepoError(error)) throw error;
        context.warnings.push(`Could not read branch "${branch}" of ${repo.full_name}`);
    }
};

/**
 * Lists branches and reads the branches GitHub already counts (default and
 * gh-pages). Their commit SHAs form the baseline used later to avoid counting
 * merged commits twice.
 */
const prepareRepo = async (repo: RepoRest, context: ScanContext): Promise<RepoPlan> => {
    const branches = await listBranches(repo, context);
    const names = new Set(branches.map((branch) => branch.name));
    const baselineBranches = new Set<string>([repo.default_branch]);
    if (names.has("gh-pages")) baselineBranches.add("gh-pages");

    const external = repo.external === true;
    const useFull = external || (repo.private && !context.privateContributionsVisible);
    const extra = useFull ? null : repo.private ? context.privateExtra : context.publicExtra;
    const full = useFull ? (external ? context.externalFull : context.privateFull) : null;

    await mapWithConcurrency([...baselineBranches], BRANCH_CONCURRENCY, async (branch) => {
        await forEachCommit(repo, branch, context, (commit) => {
            if (!external) {
                context.baselineCommits.add(commit.sha);
                context.orgCommits.add(commit.sha);
            }

            const user = commitUser(commit);
            if (user === undefined) return;
            recordUser(context, user);

            if (full === null) return;

            // External repos are never part of the org contribution graph.
            // Skip only commits that an org repo already contributed, so a
            // fork or mirror cannot count the same commit twice.
            if (external) {
                if (context.orgCommits.has(commit.sha)) return;
                if (context.seenExternalCommits.has(commit.sha)) return;
                context.seenExternalCommits.add(commit.sha);
                addActivity(full, user, "commits");
                return;
            }

            if (context.seenFullCommits.has(commit.sha)) return;
            context.seenFullCommits.add(commit.sha);
            addActivity(full, user, "commits");
        });
    });

    return {
        repo,
        extraBranches: branches.filter((branch) => !baselineBranches.has(branch.name)),
        extra,
        full,
    };
};

const scanExtraBranches = async (plan: RepoPlan, context: ScanContext): Promise<void> => {
    const { repo, extraBranches, extra, full } = plan;
    const external = repo.external === true;

    await mapWithConcurrency(extraBranches, BRANCH_CONCURRENCY, async (branch) => {
        await forEachCommit(repo, branch.name, context, (commit) => {
            if (!external) context.orgCommits.add(commit.sha);

            const user = commitUser(commit);
            if (user === undefined) return;
            recordUser(context, user);

            if (full !== null) {
                if (external) {
                    if (context.orgCommits.has(commit.sha)) return;
                    if (context.seenExternalCommits.has(commit.sha)) return;
                    context.seenExternalCommits.add(commit.sha);
                    addActivity(full, user, "commits");
                    return;
                }

                if (!context.seenFullCommits.has(commit.sha)) {
                    context.seenFullCommits.add(commit.sha);
                    addActivity(full, user, "commits");
                }
            }

            if (extra === null) return;
            if (context.baselineCommits.has(commit.sha)) return;
            if (context.seenExtraCommits.has(commit.sha)) return;

            context.seenExtraCommits.add(commit.sha);
            addActivity(extra, user, "commits");
        });
    });
};

const scanPullRequests = async (plan: RepoPlan, context: ScanContext): Promise<void> => {
    const { repo, extra, full } = plan;
    const from = context.window.from.getTime();
    const to = context.window.to.getTime();
    const path = `/repos/${repo.full_name}/pulls?state=all&sort=updated&direction=desc&per_page=100`;

    try {
        for await (const pull of context.client.paginateRest<PullRest>(path)) {
            if (timeOf(pull.updated_at) < from) break;

            const author = toRestUser(pull.user);
            if (author !== undefined) recordUser(context, author);

            const createdAt = timeOf(pull.created_at);
            const closedAt = pull.closed_at ? timeOf(pull.closed_at) : null;
            const mergedAt = pull.merged_at ? timeOf(pull.merged_at) : null;
            const createdInWindow = createdAt >= from && createdAt <= to;
            const closedInWindow =
                (closedAt !== null && closedAt >= from && closedAt <= to) ||
                (mergedAt !== null && mergedAt >= from && mergedAt <= to);
            const pullKey = `${repo.full_name}#${pull.number}`;

            if (
                full !== null &&
                (createdInWindow || closedInWindow) &&
                !context.seenFullPulls.has(pullKey)
            ) {
                context.seenFullPulls.add(pullKey);
                if (author !== undefined) addActivity(full, author, "pullRequests");
            }

            // GraphQL counts PRs opened in the window. A PR opened earlier but
            // closed or merged now is additional activity GraphQL misses.
            if (
                extra !== null &&
                !createdInWindow &&
                closedInWindow &&
                author !== undefined &&
                !context.seenExtraPulls.has(pullKey)
            ) {
                context.seenExtraPulls.add(pullKey);
                addActivity(extra, author, "pullRequests");
            }

            // A review submitted in the window necessarily updates the PR, so
            // this updated-desc listing visits every PR that can hold one.
            const reviewers = new Map<string, UserNode>();
            try {
                for await (const review of context.client.paginateRest<ReviewRest>(
                    `/repos/${repo.full_name}/pulls/${pull.number}/reviews?per_page=100`,
                )) {
                    if (review.submitted_at === null) continue;
                    const submittedAt = timeOf(review.submitted_at);
                    if (submittedAt < from || submittedAt > to) continue;

                    const reviewer = toRestUser(review.user);
                    if (reviewer === undefined) continue;
                    recordUser(context, reviewer);
                    reviewers.set(reviewer.login.toLowerCase(), reviewer);
                }
            } catch (error) {
                if (!isSkippableRepoError(error)) throw error;
                context.warnings.push(
                    `Could not read reviews for ${repo.full_name}#${pull.number}`,
                );
            }

            if (full === null) continue;
            for (const [login, reviewer] of reviewers) {
                const reviewKey = `${pullKey}#${login}`;
                if (context.seenFullReviews.has(reviewKey)) continue;
                context.seenFullReviews.add(reviewKey);
                addActivity(full, reviewer, "reviews");
            }
        }
    } catch (error) {
        if (!isSkippableRepoError(error)) throw error;
        context.warnings.push(`Could not read pull requests for ${repo.full_name}`);
    }
};

const scanIssues = async (plan: RepoPlan, context: ScanContext): Promise<void> => {
    const { repo, extra, full } = plan;
    const from = context.window.from.getTime();
    const to = context.window.to.getTime();
    const query = new URLSearchParams({
        state: "all",
        sort: "updated",
        direction: "desc",
        since: context.window.from.toISOString(),
        per_page: "100",
    });
    const path = `/repos/${repo.full_name}/issues?${query.toString()}`;

    try {
        for await (const issue of context.client.paginateRest<IssueRest>(path)) {
            if (timeOf(issue.updated_at) < from) break;
            if (issue.pull_request !== undefined) continue;

            const opener = toRestUser(issue.user);
            const closer = toRestUser(issue.closed_by);
            if (opener !== undefined) recordUser(context, opener);
            if (closer !== undefined) recordUser(context, closer);

            const createdAt = timeOf(issue.created_at);
            const closedAt = issue.closed_at ? timeOf(issue.closed_at) : null;
            const createdInWindow = createdAt >= from && createdAt <= to;
            const closedInWindow = closedAt !== null && closedAt >= from && closedAt <= to;
            const issueKey = `${repo.full_name}#${issue.number}`;
            const openerLogin = opener?.login.toLowerCase();
            const closerLogin = closer?.login.toLowerCase();

            if (full !== null) {
                if (createdInWindow && opener !== undefined && openerLogin !== undefined) {
                    const key = `${issueKey}#${openerLogin}`;
                    if (!context.seenFullIssues.has(key)) {
                        context.seenFullIssues.add(key);
                        addActivity(full, opener, "issues");
                    }
                }

                if (closedInWindow && closer !== undefined && closerLogin !== undefined) {
                    const key = `${issueKey}#${closerLogin}`;
                    if (!context.seenFullIssues.has(key)) {
                        context.seenFullIssues.add(key);
                        addActivity(full, closer, "issues");
                    }
                }
            }

            // GraphQL already counted the opener when the issue was created in
            // the window. Credit the closer only when that is a different act.
            if (
                extra !== null &&
                closedInWindow &&
                closer !== undefined &&
                closerLogin !== undefined &&
                (closerLogin !== openerLogin || !createdInWindow)
            ) {
                const key = `${issueKey}#${closerLogin}`;
                if (!context.seenExtraIssues.has(key)) {
                    context.seenExtraIssues.add(key);
                    addActivity(extra, closer, "issues");
                }
            }
        }
    } catch (error) {
        if (!isSkippableRepoError(error)) throw error;
        context.warnings.push(`Could not read issues for ${repo.full_name}`);
    }
};

const scanPlan = async (plan: RepoPlan, context: ScanContext): Promise<void> => {
    await scanExtraBranches(plan, context);
    await scanPullRequests(plan, context);
    await scanIssues(plan, context);
};

/**
 * Reads every visible repository — forks included — across every branch. The
 * first pass collects baseline SHAs and private fallback counts; the second
 * pass adds non-default commits, late-closed PRs and solved issues. Splitting
 * the passes keeps the baseline complete before any commit is called "extra".
 */
const scanRepos = async (
    repos: RepoRest[],
    window: TimeWindow,
    privateContributionsVisible: boolean,
    client: CollectorClient,
    warnings: string[],
): Promise<ScanResult> => {
    const context: ScanContext = {
        client,
        window,
        warnings,
        users: new Map(),
        publicExtra: new Map(),
        privateExtra: new Map(),
        privateFull: new Map(),
        externalFull: new Map(),
        baselineCommits: new Set(),
        orgCommits: new Set(),
        seenExtraCommits: new Set(),
        seenFullCommits: new Set(),
        seenExternalCommits: new Set(),
        seenExtraPulls: new Set(),
        seenFullPulls: new Set(),
        seenFullReviews: new Set(),
        seenFullIssues: new Set(),
        seenExtraIssues: new Set(),
        privateContributionsVisible,
    };

    const preparePlans = async (group: RepoRest[]): Promise<RepoPlan[]> => {
        const plans = await mapWithConcurrency(group, SCAN_REPO_CONCURRENCY, async (repo) => {
            try {
                return await prepareRepo(repo, context);
            } catch (error) {
                if (!isSkippableRepoError(error)) throw error;
                warnings.push(`Skipped repository ${repo.full_name}: ${errorDetail(error)}`);
                return null;
            }
        });
        return plans.filter((plan): plan is RepoPlan => plan !== null);
    };

    const scanPlans = async (plans: RepoPlan[]): Promise<void> => {
        await mapWithConcurrency(plans, SCAN_REPO_CONCURRENCY, async (plan) => {
            try {
                await scanPlan(plan, context);
            } catch (error) {
                if (!isSkippableRepoError(error)) throw error;
                warnings.push(`Partially scanned ${plan.repo.full_name}: ${errorDetail(error)}`);
            }
        });
    };

    // Organization repos first: their complete commit set is the baseline
    // that stops an allowed external fork from double-counting the same SHA.
    await scanPlans(await preparePlans(repos.filter((repo) => repo.external !== true)));
    await scanPlans(await preparePlans(repos.filter((repo) => repo.external === true)));

    return {
        users: context.users,
        publicExtra: context.publicExtra,
        privateExtra: context.privateExtra,
        privateFull: context.privateFull,
        externalFull: context.externalFull,
    };
};

/** True when the token's scope lets GraphQL include private contributions. */
const privateContributionsAreVisible = async (client: CollectorClient): Promise<boolean> => {
    if (client.getScopes === undefined) return false;
    try {
        const scopes = await client.getScopes();
        return scopes?.includes("read:user") ?? false;
    } catch {
        return false;
    }
};

/**
 * Adds scanned counts to the GraphQL totals. Merging is by login because
 * direct REST reads do not share GraphQL's node-id key for every contributor
 * (for example, issue authors who never committed).
 */
const mergeActivity = (
    contributors: RawContributor[],
    activity: Map<string, ActivityCounts>,
): RawContributor[] => {
    const byLogin = new Map(contributors.map((entry) => [entry.login.toLowerCase(), entry]));

    for (const [login, counts] of activity) {
        const existing = byLogin.get(login);
        if (existing !== undefined) {
            existing.commits += counts.commits;
            existing.pullRequests += counts.pullRequests;
            existing.reviews += counts.reviews;
            existing.issues += counts.issues;
            continue;
        }

        const created: RawContributor = {
            key: counts.user.id,
            login: counts.user.login,
            avatarUrl: counts.user.avatarUrl,
            commits: counts.commits,
            pullRequests: counts.pullRequests,
            reviews: counts.reviews,
            issues: counts.issues,
        };
        byLogin.set(login, created);
        contributors.push(created);
    }

    return contributors;
};

/**
 * External projects only count for people who also contributed inside the
 * organization during the same window. A project owner or passer-by whose only
 * visible work is the external repository is not a club contributor, so its
 * activity is dropped instead of putting an outsider on the board.
 */
const externalActivityForOrg = (
    external: Map<string, ActivityCounts>,
    orgContributors: readonly RawContributor[],
): Map<string, ActivityCounts> => {
    const orgLogins = new Set(
        orgContributors
            .filter(
                (entry) =>
                    entry.commits + entry.pullRequests + entry.reviews + entry.issues > 0,
            )
            .map((entry) => entry.login.toLowerCase()),
    );

    return new Map([...external].filter(([login]) => orgLogins.has(login)));
};

interface BatchResult {
    user: BatchUser | null;
    error?: string;
}

const queryContributionBatch = async (
    batch: UserNode[],
    orgId: string,
    window: TimeWindow,
    client: CollectorClient,
): Promise<BatchResult[]> => {
    const variables: Record<string, unknown> = {
        orgId,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
    };
    batch.forEach((user, index) => {
        variables[`l${index}`] = user.login;
    });

    try {
        const data = await client.graphql<BatchResponse>(
            buildContributionsQuery(batch.length),
            variables,
        );
        return batch.map((_, index) => ({ user: data[`u${index}`] ?? null }));
    } catch (error) {
        if (!isUnresolvableUser(error)) throw error;

        if (batch.length === 1) {
            const detail = error instanceof Error ? error.message : String(error);
            return [{ user: null, error: `Skipped "${batch[0].login}": ${detail}` }];
        }

        const results: BatchResult[] = [];
        for (const user of batch) {
            results.push(...(await queryContributionBatch([user], orgId, window, client)));
        }
        return results;
    }
};

export const collectContributions = async (
    orgLogin: string,
    period: Period,
    now: Date,
    customRange?: CustomRange,
    client: CollectorClient = githubClient,
    extraRepos: readonly string[] = [],
): Promise<CollectResult> => {
    const warnings: string[] = [];

    // 1. Organization + members. A missing org fails loudly here; a permission
    //    problem falls back to public members + repo contributors.
    const org = await fetchOrgWithMembers(orgLogin, client, extraRepos, warnings);
    const window = resolveWindow(period, now, { orgCreatedAt: org.createdAt, customRange });
    const chunks = splitWindow(window);

    // 2. Read every visible repository once. This discovers contributors that
    //    the member/contributor lists miss and collects the activity GraphQL
    //    cannot express: non-default branches, late-closed PRs and solved issues.
    const privateVisible = await privateContributionsAreVisible(client);
    const scan = await scanRepos(org.repos, window, privateVisible, client, warnings);

    const users: UserNode[] = [...org.members];

    // 3. Outside collaborators via REST — GitHub exposes no GraphQL field for
    //    them, and listing requires org ownership. A permission error is
    //    expected for non-owner tokens and is not a snapshot warning; any
    //    other failure is reported.
    try {
        const path = `/orgs/${encodeURIComponent(orgLogin)}/outside_collaborators?per_page=100`;
        for await (const collaborator of client.paginateRest<OutsideCollaboratorRest>(path)) {
            if (collaborator.login === undefined || collaborator.login.length === 0) continue;
            users.push({
                id: collaborator.node_id ?? String(collaborator.id),
                login: collaborator.login,
                avatarUrl: collaborator.avatar_url ?? "",
            });
        }
    } catch (error) {
        if (!isPermissionError(error)) {
            warnings.push(`Outside collaborators unavailable: ${errorDetail(error)}`);
        }
    }

    // 4. Accounts seen in any repository are queried too, even when they are
    //    not members, collaborators or commit contributors.
    for (const user of scan.users.values()) users.push(user);

    // GitHub logins are globally unique across both sources; dedupe on them so
    // the same person is never counted twice. Bots are dropped before querying
    // because GitHub's `user(login:)` does not resolve `[bot]` accounts.
    const uniqueUsers = [
        ...new Map(
            users
                .filter((user) => user.login.length > 0 && !isBotLogin(user.login))
                .map((user) => [user.login.toLowerCase(), user] as const),
        ).values(),
    ];

    // 5. Contributions, batched. Multi-year windows are queried one chunk at a
    //    time and summed, because GitHub caps a single range at one year.
    const batches: UserNode[][] = [];
    for (let start = 0; start < uniqueUsers.length; start += BATCH_SIZE) {
        batches.push(uniqueUsers.slice(start, start + BATCH_SIZE));
    }

    const batchContributors = await mapWithConcurrency(
        batches,
        CONTRIBUTION_CONCURRENCY,
        async (batch) => {
            const totals = new Map<string, RawContributor>();
            const reported = new Set<string>();
            const reportedNoData = new Set<string>();

            for (const chunk of chunks) {
                const results = await queryContributionBatch(batch, org.id, chunk, client);

                results.forEach(({ user: result, error }, index) => {
                    const login = batch[index].login;

                    if (result === null || result === undefined) {
                        if (!reported.has(login)) {
                            reported.add(login);
                            warnings.push(error ?? `GitHub returned no user for login "${login}"`);
                        }
                        return;
                    }

                    const collection = result.contributionsCollection;
                    if (
                        (collection === null || collection === undefined) &&
                        !reportedNoData.has(result.login)
                    ) {
                        reportedNoData.add(result.login);
                        warnings.push(`No contribution data for "${result.login}"; counted as zero`);
                    }

                    const existing = totals.get(result.id);
                    if (existing === undefined) {
                        totals.set(result.id, {
                            key: result.id,
                            login: result.login,
                            avatarUrl: result.avatarUrl,
                            commits: collection?.totalCommitContributions ?? 0,
                            pullRequests: collection?.totalPullRequestContributions ?? 0,
                            reviews: collection?.totalPullRequestReviewContributions ?? 0,
                            issues: collection?.totalIssueContributions ?? 0,
                        });
                        return;
                    }

                    existing.commits += collection?.totalCommitContributions ?? 0;
                    existing.pullRequests += collection?.totalPullRequestContributions ?? 0;
                    existing.reviews += collection?.totalPullRequestReviewContributions ?? 0;
                    existing.issues += collection?.totalIssueContributions ?? 0;
                    existing.login = result.login;
                    existing.avatarUrl = result.avatarUrl;
                });
            }

            return [...totals.values()];
        },
    );

    let contributors = batchContributors.flat();

    // 6. Add what GraphQL's contribution graph leaves out. Public repositories
    //    always have GraphQL counts; private ones only when `read:user` is
    //    available, otherwise the full direct scan is the only source.
    contributors = mergeActivity(contributors, scan.publicExtra);
    contributors = mergeActivity(
        contributors,
        privateVisible ? scan.privateExtra : scan.privateFull,
    );

    // 7. External projects are a bonus for club contributors, never an entry
    //    point: an account must already have organization activity in this
    //    window to keep the work it did on the external project. The direct
    //    scan is the only source of external counts because the
    //    organization-scoped contribution graph cannot see those repositories.
    contributors = mergeActivity(
        contributors,
        externalActivityForOrg(scan.externalFull, contributors),
    );

    return {
        contributors,
        warnings,
        window,
        orgCreatedAt: org.createdAt,
    };
};

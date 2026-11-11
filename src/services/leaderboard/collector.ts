import { GitHubError } from "../github/errors.js";
import { githubClient } from "../github/githubClient.js";
import { drain, paginateGraphql } from "../github/pagination.js";
import type { GraphqlPage } from "../github/types.js";
import type { TimeWindow } from "./periods.js";
import type { CollectResult, RawContributor } from "./types.js";

/** Users per GraphQL request. Keeps query complexity (and cost) predictable. */
const BATCH_SIZE = 10;

export const ORG_MEMBERS_QUERY = `
query ($login: String!, $cursor: String) {
  organization(login: $login) {
    id
    login
    membersWithRole(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id login avatarUrl }
    }
  }
}`;

/**
 * Aliased batch: one request pulls identity + contributions for up to
 * BATCH_SIZE users. Logins travel as variables ($l0, $l1, ...) — never
 * interpolated into the query string — so no escaping rules to get wrong.
 */
export const buildContributionsQuery = (batchSize: number): string => {
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
    organization: {
        id: string;
        login: string;
        membersWithRole: NodesPage<UserNode>;
    } | null;
}

interface OutsideCollaboratorRest {
    id: number;
    login: string;
    avatar_url: string;
}

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
}

const requireOrg = <T>(organization: T | null | undefined, orgLogin: string): T => {
    if (organization === null || organization === undefined) {
        throw new GitHubError(`Organization not found: ${orgLogin}`, 404);
    }
    return organization;
};

export const collectContributions = async (
    orgLogin: string,
    window: TimeWindow,
    client: CollectorClient = githubClient,
): Promise<CollectResult> => {
    const warnings: string[] = [];
    const users: UserNode[] = [];

    // 1. Members (paginated). A missing org fails loudly here. The first page
    //    also carries the org node ID that contributions must be scoped to.
    let orgNodeId: string | undefined;
    const memberPages = async (cursor: string | null): Promise<GraphqlPage<UserNode>> => {
        const data = await client.graphql<OrgMembersResponse>(ORG_MEMBERS_QUERY, { login: orgLogin, cursor });
        const organization = requireOrg(data.organization, orgLogin);
        orgNodeId ??= organization.id;
        return asItemsPage(organization.membersWithRole);
    };
    users.push(...(await drain(paginateGraphql(memberPages))));

    if (orgNodeId === undefined) {
        throw new GitHubError(`Could not resolve organization: ${orgLogin}`, 404);
    }

    // 2. Outside collaborators via REST — GitHub exposes no GraphQL field for
    //    them, and listing requires org ownership, so any failure degrades to
    //    a warning instead of failing the refresh.
    try {
        const path = `/orgs/${encodeURIComponent(orgLogin)}/outside_collaborators?per_page=100`;
        for await (const collaborator of client.paginateRest<OutsideCollaboratorRest>(path)) {
            if (collaborator.login === undefined || collaborator.login.length === 0) continue;
            users.push({
                id: String(collaborator.id),
                login: collaborator.login,
                avatarUrl: collaborator.avatar_url ?? "",
            });
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(`Outside collaborators unavailable: ${detail}`);
    }

    // GitHub logins are globally unique across both sources; dedupe on them so
    // the same person is never counted twice.
    const uniqueUsers = [
        ...new Map(
            users
                .filter((user) => user.login.length > 0)
                .map((user) => [user.login.toLowerCase(), user] as const),
        ).values(),
    ];

    // 3. Contributions, batched. Null results (deleted/renamed accounts) are
    //    recorded and skipped rather than failing the whole refresh.
    const contributors: RawContributor[] = [];

    for (let start = 0; start < uniqueUsers.length; start += BATCH_SIZE) {
        const batch = uniqueUsers.slice(start, start + BATCH_SIZE);

        const variables: Record<string, unknown> = {
            orgId: orgNodeId,
            from: window.from.toISOString(),
            to: window.to.toISOString(),
        };

        batch.forEach((user, index) => {
            variables[`l${index}`] = user.login;
        });

        const data = await client.graphql<BatchResponse>(buildContributionsQuery(batch.length), variables);

        batch.forEach((user, index) => {
            const alias = `u${index}`;
            const result = data[alias];

            if (result === null || result === undefined) {
                warnings.push(`GitHub returned no user for login "${user.login}"`);
                return;
            }

            const collection = result.contributionsCollection;
            if (collection === null || collection === undefined) {
                warnings.push(`No contribution data for "${result.login}"; counted as zero`);
            }

            contributors.push({
                key: result.id,
                login: result.login,
                avatarUrl: result.avatarUrl,
                commits: collection?.totalCommitContributions ?? 0,
                pullRequests: collection?.totalPullRequestContributions ?? 0,
                reviews: collection?.totalPullRequestReviewContributions ?? 0,
                issues: collection?.totalIssueContributions ?? 0,
            });
        });
    }

    return { contributors, warnings };
};

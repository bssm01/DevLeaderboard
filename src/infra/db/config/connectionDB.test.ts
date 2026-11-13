import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "../../../config/schema.js";
import { buildMongoUrl, describeMongoTarget } from "./connectionDB.js";

const local = (overrides: Partial<DatabaseConfig> = {}): DatabaseConfig => ({
    Url: undefined,
    Scheme: "mongodb",
    Host: "localhost",
    Port: 27017,
    User: "",
    Password: "",
    Name: "wawachi",
    ...overrides,
});

describe("buildMongoUrl", () => {
    it("builds a local URL without credentials when none are set", () => {
        expect(buildMongoUrl(local())).toBe("mongodb://localhost:27017/wawachi");
    });

    it("encodes credentials that are illegal in a URL", () => {
        const url = buildMongoUrl(local({ User: "me@example.com", Password: "p@ss:word/x" }));

        expect(url).toBe("mongodb://me%40example.com:p%40ss%3Aword%2Fx@localhost:27017/wawachi");
    });

    it("requires both a user and a password before adding credentials", () => {
        // A lone username would produce a malformed `user@host` URL; the
        // schema rejects that combination at boot, this stays defensive.
        expect(buildMongoUrl(local({ User: "admin" }))).toBe(
            "mongodb://localhost:27017/wawachi",
        );
        expect(buildMongoUrl(local({ Password: "secret" }))).toBe(
            "mongodb://localhost:27017/wawachi",
        );
    });

    it("builds an Atlas-style SRV URL from discrete fields, without a port", () => {
        const url = buildMongoUrl(
            local({
                Scheme: "mongodb+srv",
                Host: "cluster0.abcde.mongodb.net",
                Port: 27017, // present in config, must NOT reach the URI
                User: "atlasuser",
                Password: "s3cret",
                Name: "wawachi",
            }),
        );

        expect(url).toBe("mongodb+srv://atlasuser:s3cret@cluster0.abcde.mongodb.net/wawachi");
        expect(url).not.toContain("27017");
    });

    it("encodes credentials in an SRV URL too", () => {
        const url = buildMongoUrl(
            local({
                Scheme: "mongodb+srv",
                Host: "cluster0.abcde.mongodb.net",
                User: "me@example.com",
                Password: "p@ss:word",
                Name: "wawachi",
            }),
        );

        expect(url).toBe(
            "mongodb+srv://me%40example.com:p%40ss%3Aword@cluster0.abcde.mongodb.net/wawachi",
        );
    });

    it("returns DATABASE_URL verbatim when set, ignoring the discrete fields", () => {
        const atlas =
            "mongodb+srv://user:pass@cluster0.abcde.mongodb.net/wawachi?retryWrites=true&w=majority";

        expect(buildMongoUrl(local({ Url: atlas }))).toBe(atlas);
        // The local fields are still valid config, just not used.
        expect(buildMongoUrl(local({ Url: atlas, Host: "ignored", Port: 1 }))).toBe(atlas);
    });
});

describe("describeMongoTarget", () => {
    it("reports host and name from the discrete fields", () => {
        expect(describeMongoTarget(local())).toEqual({ host: "localhost", name: "wawachi" });
    });

    it("never leaks credentials when summarising an Atlas URL", () => {
        const atlas =
            "mongodb+srv://supersecret:othersecret@cluster0.abcde.mongodb.net/wawachi?retryWrites=true&w=majority";

        const summary = describeMongoTarget(local({ Url: atlas }));

        expect(summary).toEqual({ host: "cluster0.abcde.mongodb.net", name: "wawachi" });
        expect(JSON.stringify(summary)).not.toContain("supersecret");
        expect(JSON.stringify(summary)).not.toContain("othersecret");
    });

    it("reports the default database when the URL has no path", () => {
        expect(describeMongoTarget(local({ Url: "mongodb://localhost:27017" }))).toEqual({
            host: "localhost",
            name: "(default)",
        });
    });

    it("degrades safely instead of throwing on a mangled URL", () => {
        // Schema validation normally prevents this; the logger must not be
        // the thing that crashes the shutdown path.
        expect(() => describeMongoTarget(local({ Url: "mongodb://[invalid" }))).not.toThrow();
        expect(describeMongoTarget(local({ Url: "mongodb://[invalid" })).name).toBe("wawachi");
    });
});

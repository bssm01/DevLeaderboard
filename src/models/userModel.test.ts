import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import User, {
    DEFAULT_IMAGE,
    loginValidation,
    registerValidation,
    toPublicUser,
} from "./userModel.js";

describe("registerValidation", () => {
    it("accepts valid input", () => {
        const result = registerValidation.safeParse({
            name: "Ada Lovelace",
            email: "ada@example.com",
            password: "secret1",
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid email", () => {
        const result = registerValidation.safeParse({ name: "Ada", email: "not-an-email", password: "secret1" });
        expect(result.success).toBe(false);
    });

    it("rejects a password shorter than 6 characters", () => {
        const result = registerValidation.safeParse({ name: "Ada", email: "ada@example.com", password: "12345" });
        expect(result.success).toBe(false);
    });

    it("rejects an empty name", () => {
        const result = registerValidation.safeParse({ name: "   ", email: "ada@example.com", password: "secret1" });
        expect(result.success).toBe(false);
    });

    it("trims surrounding whitespace", () => {
        const result = registerValidation.parse({
            name: "  Ada  ",
            email: "  ada@example.com  ",
            password: "  secret1  ",
        });

        expect(result.name).toBe("Ada");
        expect(result.email).toBe("ada@example.com");
        expect(result.password).toBe("secret1");
    });
});

describe("loginValidation", () => {
    it("accepts valid credentials", () => {
        const result = loginValidation.safeParse({ email: "ada@example.com", password: "secret1" });
        expect(result.success).toBe(true);
    });

    it("rejects a missing password", () => {
        const result = loginValidation.safeParse({ email: "ada@example.com" });
        expect(result.success).toBe(false);
    });
});

describe("toPublicUser", () => {
    it("never exposes the password hash", () => {
        const user = {
            _id: new mongoose.Types.ObjectId(),
            name: "Ada",
            email: "ada@example.com",
            image: "img/ada.jpg",
            password: "$2b$10$abcdefghijklmnopqrstuv",
        };

        const publicUser = toPublicUser(user);

        expect(publicUser).toEqual({
            id: user._id.toString(),
            name: "Ada",
            email: "ada@example.com",
            image: "img/ada.jpg",
        });
        expect(publicUser).not.toHaveProperty("password");
    });

    it("falls back to the default image when none is stored", () => {
        const publicUser = toPublicUser({
            _id: new mongoose.Types.ObjectId(),
            name: "Ada",
            email: "ada@example.com",
        });

        expect(publicUser.image).toBe(DEFAULT_IMAGE);
    });
});

describe("User schema", () => {
    it("uses a forward slash in the default image path", () => {
        const doc = new User({ name: "Ada", email: "ada@example.com", password: "secret1" });
        expect(doc.image).toBe("img/defaultUser.jpg");
        expect(doc.image).not.toContain("\\");
    });

    it("lowercases and trims the email", () => {
        const doc = new User({ name: "Ada", email: "  ADA@Example.COM ", password: "secret1" });
        expect(doc.email).toBe("ada@example.com");
    });

    it("keeps the password out of default selections", () => {
        const passwordPath = User.schema.path("password");
        expect(passwordPath.options.select).toBe(false);
    });

    it("requires a unique email", () => {
        const emailPath = User.schema.path("email");
        expect(emailPath.options.unique).toBe(true);
    });
});

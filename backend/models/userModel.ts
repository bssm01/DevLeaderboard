import mongoose from "mongoose";
import { z } from "zod";

const DEFAULT_IMAGE = "img/defaultUser.jpg";

interface UserAttrs {
    name: string;
    email: string;
    password: string;
    image?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface PublicUser {
    id: string;
    name: string;
    email: string;
    image: string;
}

const userSchema = new mongoose.Schema<UserAttrs>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        // Never selected implicitly: callers must opt in with .select("+password").
        password: {
            type: String,
            required: true,
            select: false,
        },
        image: {
            type: String,
            default: DEFAULT_IMAGE,
        },
    },
    {
        timestamps: true,
    },
);

export const loginValidation = z.object({
    email: z.string().trim().email("Invalid email address"),
    password: z.string().trim().min(6, "Password must be at least 6 characters long"),
});

export const registerValidation = z.object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Invalid email address"),
    password: z.string().trim().min(6, "Password must be at least 6 characters long"),
});

// Works with a mongoose document, a plain object or a test fixture: anything
// that carries these four fields. The password hash can never come along.
export const toPublicUser = <T extends { _id: unknown; name: string; email: string; image?: string }>(
    user: T,
): PublicUser => ({
    id: String(user._id),
    name: user.name,
    email: user.email,
    image: user.image ?? DEFAULT_IMAGE,
});

const User = mongoose.model<UserAttrs>("User", userSchema);

export default User;

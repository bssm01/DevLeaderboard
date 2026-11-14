import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/config.js";
import { HttpError } from "../middleware/errorHandler.js";
import User, { loginValidation, registerValidation, toPublicUser } from "../models/userModel.js";

const BCRYPT_ROUNDS = 10;

// Computed once at startup so "unknown email" and "wrong password" take the
// same amount of time, which prevents account enumeration by timing.
const PLACEHOLDER_PASSWORD_HASH = bcrypt.hashSync("placeholder-password", BCRYPT_ROUNDS);

const signToken = (userId: string): string =>
    jwt.sign({ id: userId }, config.Jwt.Secret, { expiresIn: config.Jwt.ExpiresMinutes * 60 });

export const register = async (req: Request, res: Response): Promise<void> => {
    const data = registerValidation.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    // A concurrent duplicate registration surfaces as Mongo error 11000 and is
    // translated to 409 by the global error handler.
    const user = await User.create({
        name: data.name,
        email: data.email,
        password: passwordHash,
    });

    res.status(201).json({
        message: "User registered successfully",
        user: toPublicUser(user),
        token: signToken(String(user._id)),
    });
};

export const login = async (req: Request, res: Response): Promise<void> => {
    const data = loginValidation.parse(req.body);
    const user = await User.findOne({ email: data.email }).select("+password");

    if (!user) {
        await bcrypt.compare(data.password, PLACEHOLDER_PASSWORD_HASH);
        throw new HttpError(401, "Invalid email or password");
    }

    const valid = await bcrypt.compare(data.password, user.password);
    if (!valid) {
        throw new HttpError(401, "Invalid email or password");
    }

    res.status(200).json({
        message: "Login successful",
        user: toPublicUser(user),
        token: signToken(String(user._id)),
    });
};

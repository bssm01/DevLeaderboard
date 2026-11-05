import {registerValidation, loginValidation } from "../models/userModel.js";
import User from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import {ZodError} from "zod";
import jwt from "jsonwebtoken";


export const register = async (req: Request, res: Response) => {
    try {
        const validatedData = registerValidation.parse(req.body);

        const user = await User.findOne({ email: validatedData.email });
        if (user) {
            return res.status(400).json({ error: "User already exists" });
        }
        const hashedPassword = await bcrypt.hash(validatedData.password, 10);
        const newUser = await User.create({
            name: validatedData.name,
            email: validatedData.email,
            password: hashedPassword,
        });

        const token = jwt.sign({id:newUser._id} , process.env.JWT_SECRET as string, {expiresIn:"1h"});
        
        res.status(201).json({newUser ,  message: "User registered successfully", token}); 
        
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ error: error.issues });
        }
        res.status(500).json({ error: "Internal server error" });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const validatedData = loginValidation.parse(req.body);
        const user = await User.findOne({ email: validatedData.email });
        if (!user) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const isPasswordValid = await bcrypt.compare(validatedData.password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: "Invalid email or password" });
        }

       const token = jwt.sign({id:user._id} , process.env.JWT_SECRET as string, {expiresIn:"1h"});

        res.status(200).json({ message: "Login successful", token });
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ error: error.issues });
        }
        res.status(500).json({ error: "Internal server error" });
    }
};
    
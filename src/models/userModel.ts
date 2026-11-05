import mongoose from "mongoose";
import {z} from "zod";


const schema = new mongoose.Schema({
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
    password: {
    type: String,
    required: true,
    },
    image: {
    type: String,
    default:"img\\defaultUser.jpg"
    }},{
    timestamps: true,
    })

    const loginValidation = z.object({
    email: z.string().trim().email("Invalid email address"),
    password: z.string().trim().min(6, "Password must be at least 6 characters long"),
    });

    const registerValidation = z.object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Invalid email address"),
    password: z.string().trim().min(6, "Password must be at least 6 characters long"),
    });

    const User = mongoose.model("User" , schema);

    export { loginValidation, registerValidation };
    export default User;
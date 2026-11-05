import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "src/config/.env") });

export const connectDB = async () => {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error("DATABASE_URL is not defined. Add it to src/config/.env");
  }

  try {
    await mongoose.connect(dbUrl);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
};
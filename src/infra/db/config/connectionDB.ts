import mongoose from "mongoose";
import { config } from "../../../config/config.js";

export const connectDB = async () => {
  const { User, Password, Host, Port, Name } = config.Database;
  const dbUrl = `mongodb://${User}:${Password}@${Host}:${Port}/${Name}`;

  try {
    await mongoose.connect(dbUrl);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
};

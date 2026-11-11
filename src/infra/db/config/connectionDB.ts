import mongoose from "mongoose";
import { config } from "../../../config/config.js";
import { logger } from "../../../lib/logger.js";

export const connectDB = async (): Promise<void> => {
  const { Host, Port, User, Password, Name } = config.Database;
  // Credentials may contain characters that are illegal in a URL (@, :, /).
  const credentials = User && Password ? `${encodeURIComponent(User)}:${encodeURIComponent(Password)}@` : "";
  const dbUrl = `mongodb://${credentials}${Host}:${Port}/${Name}`;

  try {
    // Fail fast instead of waiting the default 30s for server selection.
    await mongoose.connect(dbUrl, { serverSelectionTimeoutMS: 5000 });
    logger.info("mongodb connected", { host: Host, port: Port, name: Name });
  } catch (error) {
    logger.error("mongodb connection failed", { host: Host, port: Port, name: Name, err: error });
    process.exit(1);
  }
};

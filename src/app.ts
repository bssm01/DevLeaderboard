import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./infra/db/config/connectionDB.js";
import path from "node:path";
import authRoutes from "./routes/authRoutes.js";
dotenv.config({ path: path.resolve(process.cwd(), "src/config/.env") });


const app = express();
app.use(express.json());
app.use("/auth", authRoutes);

const PORT = process.env.PORT || 3000;

await connectDB();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });




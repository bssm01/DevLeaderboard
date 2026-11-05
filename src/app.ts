import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./config/connectionDB.js";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "src/config/.env") });


const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

connectDB()
app.get("/:id",(req,res)=>{
   res.send(req.params.id) 
})


try {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
} catch (error) {
    console.error("Error starting the server:", error);
}

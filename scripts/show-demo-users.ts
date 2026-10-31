import "dotenv/config";
import { readFileSync } from "node:fs";
if (process.env.NODE_ENV === "production") throw new Error("Development only");
try {
  console.log(readFileSync(".local/hackathon-demo-login.txt", "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  throw new Error("Run npm.cmd run db:seed first to create the local demo credentials.", { cause: error });
}

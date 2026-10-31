import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((v) => !v.includes("REPLACE")),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  BUSINESS_TIMEZONE: z.string().default("Asia/Kolkata"),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default("Brightloop <billing@brightloop.local>"),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  GROQ_MODEL: z.string().trim().min(1).default("openai/gpt-oss-20b"),
});
export const config = schema.parse(process.env);
if (
  config.NODE_ENV === "production" &&
  (!config.WEB_ORIGIN.startsWith("https://") ||
    !config.BETTER_AUTH_URL.startsWith("https://"))
)
  throw new Error("Production requires HTTPS origins");

import { z } from "zod";
import "dotenv/config";

const envVariables = z.object({
  KEYS: z.string(),
  RPCS: z.string(),
  AUTH_HEADER: z.string(),
  MONGO_DATABASE: z.string().url(),
});

export const env = envVariables.parse(process.env);

import OpenAI from "openai";
import { env } from "./env.js";

export const asi = new OpenAI({
  apiKey: env.ASI_API_KEY,
  baseURL: "https://api.asi1.ai/v1",
});

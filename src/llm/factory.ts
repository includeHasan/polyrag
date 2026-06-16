import { ChatOpenAI } from "@langchain/openai"
import { createKeyedCache } from "@/shared/keyedCache.js"
import { env } from "@/config/env.js"

interface LLMOptions {
  model: string
  temperature?: number
  maxTokens?: number
}

const cache = createKeyedCache<ChatOpenAI>({ maxSize: 50 })

export function getLLM(opts: LLMOptions): ChatOpenAI {
  const key = JSON.stringify({ model: opts.model, temperature: opts.temperature ?? 0 })
  return cache.get(key, () => new ChatOpenAI({
    openAIApiKey: env.OPENAI_API_KEY,
    modelName: opts.model,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens,
  }))
}

export function resetLLMCache(): void {
  cache.clear()
}

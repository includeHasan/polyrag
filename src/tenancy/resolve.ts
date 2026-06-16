import { llmConfig, retrievalConfig, chunkingConfig } from "@/config/index.js";

export interface ResolvedTenantConfig {
  persona: {
    domain: string;
  };
  prompts: Record<string, string>;
  models: {
    generationModel: string;
    evaluationModel: string;
    rerankModel: string;
  };
  chunking: {
    strategy: "fixed" | "recursive" | "semantic" | "agentic";
    chunkSize: number;
    chunkOverlap: number;
  };
  retrieval: {
    topK: number;
    rerankTopK: number;
    rerankerEnabled: boolean;
    hybridSearchEnabled: boolean;
    kgEnabled: boolean;
  };
  quotas: {
    userPerMin: number;
    tenantPerMin: number;
    monthlyTokenCap?: number;
  };
}

export type TenantConfigOverrides = {
  persona?: Partial<ResolvedTenantConfig["persona"]>;
  prompts?: Record<string, string>;
  models?: Partial<ResolvedTenantConfig["models"]>;
  chunking?: Partial<ResolvedTenantConfig["chunking"]>;
  retrieval?: Partial<ResolvedTenantConfig["retrieval"]>;
  quotas?: Partial<ResolvedTenantConfig["quotas"]>;
};

export interface TenantContext {
  tenantId: string;
  userId: string | null;
  roles: string[];
  config: ResolvedTenantConfig;
  scope: "tenant" | "system";
}

export function buildGlobalDefaults(): ResolvedTenantConfig {
  return {
    persona: {
      domain: "General",
    },
    prompts: {},
    models: {
      generationModel: llmConfig.generationModel,
      evaluationModel: llmConfig.evaluationModel,
      rerankModel: llmConfig.rerankModel,
    },
    chunking: {
      strategy: chunkingConfig.strategy,
      chunkSize: chunkingConfig.chunkSize,
      chunkOverlap: chunkingConfig.chunkOverlap,
    },
    retrieval: {
      topK: retrievalConfig.topK,
      rerankTopK: retrievalConfig.rerankTopK,
      rerankerEnabled: retrievalConfig.rerankerEnabled,
      hybridSearchEnabled: retrievalConfig.hybridSearchEnabled,
      kgEnabled: false,
    },
    quotas: {
      userPerMin: 60,
      tenantPerMin: 600,
    },
  };
}

export function deepMergeTenantConfig(
  base: ResolvedTenantConfig,
  overrides: TenantConfigOverrides,
): ResolvedTenantConfig {
  return {
    persona: overrides.persona
      ? { ...base.persona, ...overrides.persona }
      : base.persona,
    prompts: overrides.prompts
      ? { ...base.prompts, ...overrides.prompts }
      : base.prompts,
    models: overrides.models
      ? { ...base.models, ...overrides.models }
      : base.models,
    chunking: overrides.chunking
      ? { ...base.chunking, ...overrides.chunking }
      : base.chunking,
    retrieval: overrides.retrieval
      ? { ...base.retrieval, ...overrides.retrieval }
      : base.retrieval,
    quotas: overrides.quotas
      ? { ...base.quotas, ...overrides.quotas }
      : base.quotas,
  };
}

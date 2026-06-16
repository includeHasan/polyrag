import { AsyncLocalStorage } from "node:async_hooks";
import { ConfigurationError } from "@/core/shared/errors.js";
import {
  type TenantContext,
  type ResolvedTenantConfig,
  buildGlobalDefaults,
} from "./resolve.js";

export type { TenantContext, ResolvedTenantConfig };

const als = new AsyncLocalStorage<TenantContext>();

export const SYSTEM_SCOPE: TenantContext = {
  tenantId: "SYSTEM",
  scope: "system",
  userId: null,
  roles: ["super_admin"],
  config: buildGlobalDefaults(),
};

export function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return als.getStore();
}

export function getTenantContextOrThrow(): TenantContext {
  const ctx = als.getStore();
  if (!ctx) {
    throw new ConfigurationError("No tenant context found in AsyncLocalStorage");
  }
  return ctx;
}

export function setTenantContext(ctx: TenantContext): void {
  als.enterWith(ctx);
}

// Typen zu scripts/lib/guard.mjs (für tests/guard.ts und die .mts-Skripte)
export interface SupabaseTarget {
  url?: string;
  dbUrl?: string;
}
export type GuardResult = { ok: true } | { ok: false; reason: string };
export declare function projectRefFromUrl(url: string | undefined): string | null;
export declare function projectRefFromDbUrl(dbUrl: string | undefined): string | null;
export declare function checkTestTarget(test: SupabaseTarget, prod: SupabaseTarget): GuardResult;
export declare function checkSameProject(target: SupabaseTarget): GuardResult;

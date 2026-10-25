// Typen zu scripts/lib/env.mjs (für die .mts-Skripte und Tests)
export declare const ENV_FILES: { test: string; prod: string };
export declare function log(message: string): void;
export declare function readEnv(file: string): Record<string, string>;
export declare function dbTarget(script: string): {
  target: "test" | "prod";
  file: string;
  dbUrl: string;
};
export declare function redact(error: unknown): string;
export declare function testProject(): {
  env: Record<string, string>;
  url: string;
  key: string;
};

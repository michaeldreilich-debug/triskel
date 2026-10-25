import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Repo-Wurzel: vom Arbeitsverzeichnis aufwärts bis zur package.json dieses Projekts. */
function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && readFileSync(pkg, "utf8").includes('"name": "second-brain-app"')) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Repo-Wurzel (package.json) nicht gefunden.");
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(process.cwd());

/** Minimaler .env-Parser (KEY=VALUE, Kommentare, Anführungszeichen). Führt nichts aus. */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    let value = (match[2] as string).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // Inline-Kommentar nur bei unquotierten Werten abschneiden
      value = value.replace(/\s+#.*$/, "");
    }
    result[key] = value;
  }
  return result;
}

/** Liest eine .env-Datei relativ zum Repo. Fehlt sie, kommt ein leeres Objekt zurück. */
export function readEnvFile(fileName: string): Record<string, string> {
  const file = path.join(REPO_ROOT, fileName);
  if (!existsSync(file)) return {};
  return parseEnvFile(readFileSync(file, "utf8"));
}

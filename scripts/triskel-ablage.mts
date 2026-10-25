// ---------------------------------------------------------------
// Triskel-Ablage (#76): kleines MCP-Programm am Mac, damit Claude (Claude Code und die
// Claude-Desktop-App) Dateien vom Rechner in Triskel ablegen kann – direkt vom Mac zum Speicher,
// ohne dass der Inhalt durch den Chat muss (bis 100 MB statt weniger KB über „inhalt_base64“).
//
// Ablauf: datei_vorbereiten (Foto verkleinern) → Triskel „prepare_upload“ → datei_hochladen →
// Triskel „attach_file“ mit „upload“. Das Programm kennt keine Zugangsdaten: Der Hochlade-Link
// aus „prepare_upload“ gilt 1 Stunde für genau einen Pfad und genau eine Größe. Es liest nur aus
// Downloads, Schreibtisch, Dokumente und iCloud Drive und sendet nur an den R2-Speicher des
// eigenen Cloudflare-Kontos (TRISKEL_R2_ACCOUNT_ID, sonst die Zeile R2_ACCOUNT_ID aus der
// .env.local des Repos) – bis zum Live-Gang von R2 übergangsweise auch an die Supabase-Adresse
// (TRISKEL_SUPABASE_URL). Einrichten: README › Triskel-Ablage.
// ---------------------------------------------------------------
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  type ALLOWED_FOLDERS,
  ALREADY_UPLOADED,
  accountIdFromEnvFile,
  allowedRoots,
  contentTypeFor,
  formatSize,
  imageFormat,
  MAX_IMAGE_SIDE,
  MAX_UPLOAD_BYTES,
  pathProblem,
  preparedName,
  uploadHeaders,
  uploadUrlProblem,
} from "./lib/ablage.mts";

const run = promisify(execFile);
const HOME = homedir();
/** Erlaubte Ordner, Verknüpfungen aufgelöst (z. B. Schreibtisch/Dokumente in iCloud) */
const ROOTS = allowedRoots(HOME).map((root) => {
  try {
    return realpathSync(root);
  } catch {
    return root; // Ordner fehlt – dann findet sich dort auch nichts
  }
});
const SUPABASE_URL = process.env.TRISKEL_SUPABASE_URL ?? "";
/** Nur für die Tests: Test-Bucket statt `triskel-dateien` (der Name muss genau stimmen) */
const R2_BUCKET = process.env.TRISKEL_R2_BUCKET || undefined;

/**
 * Eigenes Cloudflare-Konto: Umgebung `TRISKEL_R2_ACCOUNT_ID`, sonst allein die Zeile
 * `R2_ACCOUNT_ID` aus der .env.local des Repos (nichts sonst aus der Datei, nie ausgegeben).
 */
function r2AccountId(): string {
  const fromEnv = process.env.TRISKEL_R2_ACCOUNT_ID?.trim();
  if (fromEnv) return fromEnv;
  const file = new URL("../.env.local", import.meta.url);
  try {
    return existsSync(file) ? accountIdFromEnvFile(readFileSync(file, "utf8")) : "";
  } catch {
    return "";
  }
}
const R2_ACCOUNT_ID = r2AccountId();
/** Verkleinerte Fotos liegen nur hier (eigener Ordner je Programmstart) */
const WORK_DIR = mkdtempSync(join(tmpdir(), "triskel-ablage-"));

const FOLDER_NAMES: Record<string, (typeof ALLOWED_FOLDERS)[number]> = {
  Downloads: "Downloads",
  Schreibtisch: "Desktop",
  Dokumente: "Documents",
  "iCloud Drive": "Library/Mobile Documents/com~apple~CloudDocs",
};

class InputError extends Error {}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** Pfad auflösen (auch „~/…“) und prüfen; liefert den echten Pfad. */
function readablePath(input: string): string {
  const expanded = input.startsWith("~/") ? join(HOME, input.slice(2)) : input;
  let real: string;
  try {
    real = realpathSync(expanded);
  } catch {
    throw new InputError(`„${input}“ gibt es nicht – mit „dateien_suchen“ den genauen Pfad holen.`);
  }
  const insideWork = real.startsWith(`${realpathSync(WORK_DIR)}${sep}`);
  const problem = insideWork ? null : pathProblem(real, ROOTS);
  if (problem) throw new InputError(problem);
  const stat = statSync(real);
  if (!stat.isFile()) throw new InputError(`„${input}“ ist keine Datei.`);
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new InputError(
      `„${basename(real)}“ hat ${formatSize(stat.size)} – Triskel nimmt höchstens ${formatSize(MAX_UPLOAD_BYTES)} je Datei.`,
    );
  }
  return real;
}

/** Dateien in den erlaubten Ordnern, neueste zuerst (höchstens 3 Ebenen tief, ohne Versteckte). */
function findFiles(roots: string[], needle: string, limit: number) {
  const found: { path: string; size: number; mtime: number }[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (seen > 20_000) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // kein Zugriff (macOS fragt je Ordner) – überspringen
    }
    for (const entry of entries) {
      seen += 1;
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().includes(needle)) {
        try {
          const stat = statSync(path);
          found.push({ path, size: stat.size, mtime: stat.mtimeMs });
        } catch {
          // zwischendurch verschwunden
        }
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** Foto auf die längste Seite der App verkleinern (macOS „sips“); null = Original nehmen. */
async function shrinkImage(path: string): Promise<{ path: string; name: string } | null> {
  const format = imageFormat(path);
  if (!format) return null;
  const name = preparedName(basename(path));
  const out = join(mkdtempSync(join(WORK_DIR, "bild-")), name);
  await run("/usr/bin/sips", [
    "--resampleHeightWidthMax",
    String(MAX_IMAGE_SIDE),
    "--setProperty",
    "format",
    format,
    ...(format === "jpeg" ? ["--setProperty", "formatOptions", "85"] : []),
    path,
    "--out",
    out,
  ]);
  // Fotos bis 2000 px wachsen beim Neukodieren manchmal – dann bleibt das Original (außer HEIC)
  const grew = statSync(out).size >= statSync(path).size;
  if (name === basename(path) && grew && (await longestSide(path)) <= MAX_IMAGE_SIDE) return null;
  return { path: out, name };
}

async function longestSide(path: string): Promise<number> {
  const { stdout } = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
  return Math.max(
    ...[...stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1])),
  );
}

function createServer() {
  const server = new McpServer(
    { name: "triskel-ablage", title: "Triskel-Ablage", version: "1.0.0" },
    {
      instructions: [
        "Legt Dateien vom Mac in Triskel ab (die eigene App, KI-Verbindung „Schaltzentrale“/Triskel).",
        "Ablauf: 1. dateien_suchen (falls der Pfad unklar ist) → 2. datei_vorbereiten → 3. Triskel „prepare_upload“ mit ziel, dem Namen und der Größe (groesse, in Bytes) aus Schritt 2 → 4. datei_hochladen mit datei, upload_url und content_type → 5. Triskel „attach_file“ mit ziel, upload und name.",
        "Diesen Weg statt „attach_file“ mit „inhalt_base64“ nehmen – er geht bis 100 MB, der Inhalt läuft nicht durch den Chat.",
      ].join("\n"),
    },
  );

  const guard =
    <A,>(handler: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await handler(args);
      } catch (error) {
        if (error instanceof InputError) return { ...text(error.message), isError: true };
        throw error;
      }
    };

  server.registerTool(
    "dateien_suchen",
    {
      title: "Dateien am Mac suchen",
      description:
        "Sucht Dateien nach einem Teil des Namens in Downloads, Schreibtisch, Dokumente und iCloud Drive (bis 3 Ordner tief), neueste zuerst. Liefert den vollen Pfad für „datei_vorbereiten“.",
      inputSchema: z.object({
        suchwort: z.string().trim().default("").describe("Teil des Dateinamens, leer = alle"),
        ordner: z
          .enum(["Downloads", "Schreibtisch", "Dokumente", "iCloud Drive"])
          .optional()
          .describe("nur in diesem Ordner suchen"),
        anzahl: z.number().int().min(1).max(50).default(15),
      }),
      annotations: { title: "Dateien am Mac suchen", readOnlyHint: true, openWorldHint: false },
    },
    guard(async ({ suchwort, ordner, anzahl }) => {
      const roots = ordner ? [join(HOME, FOLDER_NAMES[ordner] as string)] : ROOTS;
      const files = findFiles(roots, suchwort.toLowerCase(), anzahl);
      if (files.length === 0) return text(`Keine Datei mit „${suchwort}“ gefunden.`);
      const lines = files.map(
        (f) =>
          `- ${f.path} (${formatSize(f.size)}, geändert ${new Date(f.mtime).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })})`,
      );
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "datei_vorbereiten",
    {
      title: "Datei vorbereiten",
      description: `Prüft eine Datei vom Mac und verkleinert Fotos wie die App (längste Seite ${MAX_IMAGE_SIDE} px, HEIC wird JPEG). Liefert „datei“, „name“ und „bytes“ (genaue Größe) für die nächsten Schritte: Triskel „prepare_upload“ mit diesem name und groesse = bytes, dann „datei_hochladen“ mit dieser datei. Andere Dateien (PDF, Excel, Word …) bleiben unverändert. Bis 100 MB.`,
      inputSchema: z.object({
        pfad: z
          .string()
          .trim()
          .min(1)
          .describe("voller Pfad, z. B. aus dateien_suchen; „~/…“ geht auch"),
      }),
      annotations: { title: "Datei vorbereiten", readOnlyHint: true, openWorldHint: false },
    },
    guard(async ({ pfad }) => {
      const real = readablePath(pfad);
      const before = statSync(real).size;
      let prepared = { path: real, name: basename(real) };
      let note = "unverändert";
      try {
        const shrunk = await shrinkImage(real);
        if (shrunk) {
          prepared = shrunk;
          note = `verkleinert von ${formatSize(before)}`;
        }
      } catch {
        note = "unverändert (Verkleinern ging nicht)";
      }
      const size = statSync(prepared.path).size;
      return text(
        [
          `datei: ${prepared.path}`,
          `name: ${prepared.name}`,
          `bytes: ${size}`,
          `Größe: ${formatSize(size)} (${note})`,
          `Weiter: Triskel „prepare_upload“ mit ziel, name „${prepared.name}“ und groesse ${size}, dann „datei_hochladen“ mit dieser datei.`,
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "datei_hochladen",
    {
      title: "Datei zu Triskel hochladen",
      description:
        "Lädt die Datei aus „datei_vorbereiten“ an den Hochlade-Link aus Triskel „prepare_upload“ hoch (nur Links von Triskel). Danach Triskel „attach_file“ mit ziel, upload und name aufrufen – erst dann erscheint die Datei in der Notiz oder Aufgabe.",
      inputSchema: z.object({
        datei: z.string().trim().min(1).describe("„datei“ aus datei_vorbereiten"),
        upload_url: z.string().trim().min(1).describe("„upload_url“ aus prepare_upload"),
        content_type: z
          .string()
          .trim()
          .optional()
          .describe("„content_type“ aus prepare_upload (sonst aus der Endung)"),
      }),
      annotations: {
        title: "Datei zu Triskel hochladen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async ({ datei, upload_url, content_type }) => {
      if (!R2_ACCOUNT_ID && !SUPABASE_URL) {
        throw new InputError(
          "Weder TRISKEL_R2_ACCOUNT_ID noch R2_ACCOUNT_ID in .env.local gefunden (README › Triskel-Ablage).",
        );
      }
      const problem = uploadUrlProblem(upload_url, {
        supabaseUrl: SUPABASE_URL,
        r2AccountId: R2_ACCOUNT_ID,
        r2Bucket: R2_BUCKET,
      });
      if (problem) throw new InputError(problem);
      const real = readablePath(datei);
      const body = readFileSync(real);
      const response = await fetch(upload_url, {
        method: "PUT",
        headers: uploadHeaders(upload_url, content_type || contentTypeFor(real)),
        body,
      });
      // Link schon benutzt: die Datei liegt im Speicher, R2 überschreibt sie nicht
      if (response.status === ALREADY_UPLOADED) {
        return text(
          "Unter diesem Hochlade-Link liegt schon eine Datei (er nimmt nur eine an, nichts wurde überschrieben). Ist es diese Datei, jetzt Triskel „attach_file“ mit ziel, upload und name aufrufen – sonst „prepare_upload“ neu aufrufen.",
        );
      }
      if (!response.ok) {
        const reason = (await response.text().catch(() => "")).slice(0, 300);
        throw new InputError(
          `Hochladen abgelehnt (${response.status}${reason ? `: ${reason}` : ""}). Ist der Link älter als 1 Stunde oder die Datei nicht mehr genau so groß wie bei „prepare_upload“, dieses neu aufrufen.`,
        );
      }
      return text(
        `Hochgeladen: ${basename(real)} (${formatSize(body.byteLength)}). Jetzt Triskel „attach_file“ mit ziel, upload und name aufrufen.`,
      );
    }),
  );

  return server;
}

serveStdio(createServer);

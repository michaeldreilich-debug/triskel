import { describe, expect, it } from "vitest";
import {
  accountIdFromEnvFile,
  allowedRoots,
  contentTypeFor,
  formatSize,
  imageFormat,
  MAX_UPLOAD_BYTES,
  pathProblem,
  preparedName,
  uploadHeaders,
  uploadUrlProblem,
} from "../../scripts/lib/ablage.mts";

const HOME = "/Users/alex";
const roots = allowedRoots(HOME);
const SUPABASE = "https://abcdefgh.supabase.co";
const SIGNED = `${SUPABASE}/storage/v1/object/upload/sign/attachments/u/n/f.pdf?token=eyJx`;

describe("Triskel-Ablage (#76): was gelesen werden darf", () => {
  it("Downloads, Schreibtisch, Dokumente und iCloud Drive – auch in Unterordnern", () => {
    expect(pathProblem(`${HOME}/Downloads/Rechnung.pdf`, roots)).toBeNull();
    expect(pathProblem(`${HOME}/Desktop/Fotos/Wache.jpg`, roots)).toBeNull();
    expect(pathProblem(`${HOME}/Documents/Beruf/2026/Liste.xlsx`, roots)).toBeNull();
    expect(
      pathProblem(`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Steuer.pdf`, roots),
    ).toBeNull();
  });

  it("sonst nichts: anderer Ordner, Nachbar mit gleichem Anfang, versteckte Dateien", () => {
    expect(pathProblem(`${HOME}/.ssh/id_ed25519`, roots)).toMatch(/Nur Dateien aus/);
    expect(pathProblem("/etc/hosts", roots)).toMatch(/Nur Dateien aus/);
    expect(pathProblem(`${HOME}/Downloads-alt/x.pdf`, roots)).toMatch(/Nur Dateien aus/);
    expect(pathProblem(`${HOME}/Documents/.env.local`, roots)).toMatch(/Versteckte/);
    expect(pathProblem(`${HOME}/Documents/projekt/.git/config`, roots)).toMatch(/Versteckte/);
  });
});

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const R2_URL = (over = "") =>
  `https://${ACCOUNT}.eu.r2.cloudflarestorage.com/triskel-dateien/attachments/u/n/f.pdf?X-Amz-Expires=3600&X-Amz-Credential=k%2Fauto&X-Amz-Signature=abc${over}`;
const R2 = { supabaseUrl: SUPABASE, r2AccountId: ACCOUNT };

describe("Triskel-Ablage (#76, E41): wohin gesendet werden darf", () => {
  it("R2: nur das eigene Konto, der Bucket triskel-dateien und signierte Links", () => {
    expect(uploadUrlProblem(R2_URL(), R2)).toBeNull();
    // fremdes Konto
    expect(
      uploadUrlProblem(R2_URL().replace(ACCOUNT, "fedcba9876543210fedcba9876543210"), R2),
    ).toMatch(/nur zu Triskel/);
    // fremder Bucket
    expect(uploadUrlProblem(R2_URL().replace("/triskel-dateien/", "/fremd/"), R2)).toMatch(
      /nicht auf den Dateispeicher/,
    );
    expect(
      uploadUrlProblem(R2_URL().replace("/triskel-dateien/", "/triskel-dateien-test/"), R2),
    ).toMatch(/nicht auf den Dateispeicher/);
    // ohne Signatur-Parameter
    for (const key of ["X-Amz-Signature", "X-Amz-Credential", "X-Amz-Expires"]) {
      expect(uploadUrlProblem(R2_URL().replace(key, "X-Other"), R2)).toMatch(/kein signierter/);
    }
    // http, Zugangsdaten, Port, Bucket allein
    expect(uploadUrlProblem(R2_URL().replace("https:", "http:"), R2)).toMatch(/https/);
    expect(uploadUrlProblem(R2_URL().replace("https://", "https://u:p@"), R2)).toMatch(/https/);
    expect(uploadUrlProblem(R2_URL().replace(".com/", ".com:8443/"), R2)).toMatch(/nur zu Triskel/);
    expect(
      uploadUrlProblem(
        R2_URL().replace("/triskel-dateien/attachments/u/n/f.pdf", "/triskel-dateien/"),
        R2,
      ),
    ).toMatch(/nicht auf den Dateispeicher/);
    // ähnlicher Host
    expect(
      uploadUrlProblem(
        R2_URL().replace(".eu.r2.cloudflarestorage.com", ".eu.r2.cloudflarestorage.com.evil.de"),
        R2,
      ),
    ).toMatch(/nur zu Triskel/);
    // ohne bekanntes Konto geht kein R2-Link
    expect(uploadUrlProblem(R2_URL(), { supabaseUrl: SUPABASE })).toMatch(/nur zu Triskel/);
  });

  it("Test-Bucket nur über den Parameter, genau dieser Name", () => {
    const test = { ...R2, r2Bucket: "triskel-dateien-test" };
    const url = R2_URL().replace("/triskel-dateien/", "/triskel-dateien-test/");
    expect(uploadUrlProblem(url, test)).toBeNull();
    expect(uploadUrlProblem(R2_URL(), test)).toMatch(/nicht auf den Dateispeicher/);
  });

  it("Übergang bis zum Live-Gang: signierte Links des eigenen Supabase-Projekts", () => {
    expect(uploadUrlProblem(SIGNED, R2)).toBeNull();
    expect(uploadUrlProblem(SIGNED, { supabaseUrl: SUPABASE })).toBeNull();
    expect(uploadUrlProblem(SIGNED.replace("abcdefgh", "fremdes"), R2)).toMatch(/nur zu Triskel/);
    expect(uploadUrlProblem(SIGNED.replace("https:", "http:"), R2)).toMatch(/nur zu Triskel/);
    expect(uploadUrlProblem(`${SUPABASE}/rest/v1/notes?token=x`, R2)).toMatch(/kein Hochlade-Link/);
    expect(uploadUrlProblem(SIGNED.replace(/\?token=.*/, ""), R2)).toMatch(/kein Hochlade-Link/);
    expect(uploadUrlProblem("kein link", R2)).toMatch(/keine gültige Adresse/);
    // ohne Supabase-Adresse (nach dem Live-Gang) bleibt nur R2
    expect(uploadUrlProblem(SIGNED, { r2AccountId: ACCOUNT })).toMatch(/nur zu Triskel/);
  });

  it("Konto-ID: nur die Zeile R2_ACCOUNT_ID aus der .env-Datei", () => {
    const env = [
      "R2_BACKUP_SECRET_ACCESS_KEY=geheim",
      `R2_ACCOUNT_ID=${ACCOUNT}`,
      "R2_ACCOUNT_ID_ANDERS=x",
    ].join("\n");
    expect(accountIdFromEnvFile(env)).toBe(ACCOUNT);
    expect(accountIdFromEnvFile(`R2_ACCOUNT_ID="${ACCOUNT}"\r\n`)).toBe(ACCOUNT);
    expect(accountIdFromEnvFile("R2_BACKUP_ACCESS_KEY_ID=a")).toBe("");
    expect(accountIdFromEnvFile("")).toBe("");
  });

  it("Grenze 100 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it("Header: If-None-Match nur, wenn der Link ihn mit signiert hat (P: ein PUT je Link)", () => {
    const exclusive = `${R2_URL()}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match`;
    expect(uploadHeaders(exclusive, "application/pdf")).toEqual({
      "Content-Type": "application/pdf",
      "If-None-Match": "*",
    });
    const plain = `${R2_URL()}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`;
    expect(uploadHeaders(plain, "image/png")).toEqual({ "Content-Type": "image/png" });
    expect(uploadHeaders(SIGNED, "image/png")).toEqual({ "Content-Type": "image/png" });
    expect(uploadHeaders("kein link", "image/png")).toEqual({ "Content-Type": "image/png" });
  });
});

describe("Triskel-Ablage (#76): verkleinern und Dateityp", () => {
  it("Fotos werden verkleinert, HEIC wird JPEG; GIF, PDF, Excel bleiben", () => {
    expect(imageFormat("a.JPG")).toBe("jpeg");
    expect(imageFormat("a.heic")).toBe("jpeg");
    expect(imageFormat("a.png")).toBe("png");
    expect(imageFormat("a.gif")).toBeNull();
    expect(imageFormat("a.pdf")).toBeNull();
    expect(imageFormat("a.xlsx")).toBeNull();
    expect(preparedName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(preparedName("Liste.xlsx")).toBe("Liste.xlsx");
  });

  it("Content-Type wie prepare_upload, Größen deutsch", () => {
    expect(contentTypeFor("x.pdf")).toBe("application/pdf");
    expect(contentTypeFor("x.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("x.xlsx")).toBe("application/octet-stream");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(164 * 1024)).toBe("164 KB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

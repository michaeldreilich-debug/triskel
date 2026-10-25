import path from "node:path";
import { REPO_ROOT } from "../../support/env-file";

/** Sitzung von Testnutzer A (gitignored, wird im Teardown gelöscht). */
export const AUTH_FILE = path.join(REPO_ROOT, "playwright", ".auth", "user-a.json");

/** Präfix für alle Daten, die E2E-Tests anlegen (Teardown löscht sie). */
export const E2E_PREFIX = "E2E-";

export const uniqueName = (label: string) =>
  `${E2E_PREFIX}${crypto.randomUUID().slice(0, 6)} ${label}`;

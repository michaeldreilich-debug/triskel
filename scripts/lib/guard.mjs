// ---------------------------------------------------------------
// Schutz vor dem falschen Projekt – gemeinsam für Tests (tests/guard.ts) und Skripte
// (scripts/lib/env.mjs, scripts/lib/backup-io.mts). Reine Prüflogik ohne Dateizugriff, gibt nie
// Werte aus (Code-Review Oktober 2026, T-1).
// ---------------------------------------------------------------

const fail = (reason) => ({ ok: false, reason: `Test-Schutzschalter: ${reason}` });

function normalizeUrl(url) {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/** Projekt-Ref aus `https://<ref>.supabase.co`. */
export function projectRefFromUrl(url) {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)(?:[/:]|$)/i.exec((url ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

/** Projekt-Ref aus einer DB-URL: Pooler-Nutzer `postgres.<ref>` oder Host `db.<ref>.supabase.co`. */
export function projectRefFromDbUrl(dbUrl) {
  const value = (dbUrl ?? "").trim();
  const pooler = /^postgres(?:ql)?:\/\/[^.:@/]+\.([a-z0-9]+)[:@]/i.exec(value);
  if (pooler) return pooler[1].toLowerCase();
  const direct = /@db\.([a-z0-9]+)\.supabase\.co(?:[:/]|$)/i.exec(value);
  return direct ? direct[1].toLowerCase() : null;
}

/** Zeigt der Test-Zugang (URL, DB-URL) sicher aufs Testprojekt und nicht auf Prod? */
export function checkTestTarget(test, prod) {
  const testUrl = normalizeUrl(test.url);
  if (!testUrl) {
    return fail("NEXT_PUBLIC_SUPABASE_URL des Testprojekts ist leer (.env.test.local).");
  }

  const prodUrl = normalizeUrl(prod.url);
  if (prodUrl && testUrl === prodUrl) {
    return fail("Die Test-URL ist die Prod-URL. Tests laufen nur gegen second-brain-test.");
  }

  const testRef = projectRefFromUrl(testUrl);
  const prodRef = projectRefFromUrl(prodUrl);
  if (testRef && prodRef && testRef === prodRef) {
    return fail("Test- und Prod-URL gehören zum selben Supabase-Projekt.");
  }

  const testDb = (test.dbUrl ?? "").trim();
  if (testDb) {
    if (prod.dbUrl && testDb === prod.dbUrl.trim()) {
      return fail("Die Test-DB-URL ist die Prod-DB-URL.");
    }
    const dbRef = projectRefFromDbUrl(testDb);
    const prodDbRef = projectRefFromDbUrl(prod.dbUrl);
    if (dbRef && ((prodRef && dbRef === prodRef) || (prodDbRef && dbRef === prodDbRef))) {
      return fail("Die Test-DB-URL zeigt auf das Prod-Projekt.");
    }
    if (dbRef && testRef && dbRef !== testRef) {
      return fail("Die Test-DB-URL gehört nicht zum Testprojekt aus NEXT_PUBLIC_SUPABASE_URL.");
    }
  }

  return { ok: true };
}

/**
 * Für Sicherung und Wiederherstellung (beide Ziele): Die DB-URL muss erkennbar zum Projekt aus
 * NEXT_PUBLIC_SUPABASE_URL gehören. Ist eine der Refs nicht lesbar, lieber abbrechen – sonst
 * sichert „prod“ still eine fremde DB oder „test“ leert sie.
 */
export function checkSameProject(target) {
  const urlRef = projectRefFromUrl(target.url);
  const dbRef = projectRefFromDbUrl(target.dbUrl);
  if (!urlRef || !dbRef) {
    return {
      ok: false,
      reason: "Projekt aus NEXT_PUBLIC_SUPABASE_URL oder SUPABASE_DB_URL nicht erkennbar.",
    };
  }
  if (urlRef !== dbRef) {
    return {
      ok: false,
      reason: "SUPABASE_DB_URL gehört nicht zum Projekt aus NEXT_PUBLIC_SUPABASE_URL.",
    };
  }
  return { ok: true };
}

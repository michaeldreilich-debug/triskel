/**
 * KI-Zugang (#33): Freigabe-Seite /ki-zugang. Ohne Anfrage ein Hinweis; mit echter Anfrage des
 * Supabase-OAuth-Servers (vertraulicher Client, im Testprojekt per Selbst-Registrierung) zeigt
 * sie Client und Ziel, „Erlauben“ trägt die Freigabe ein (ai_clients, E27 Fall B) und leitet
 * zurück, „Ablehnen“ ohne Freigabe. Ohne Anmeldung geht es erst zum Login, der Rücksprung behält
 * die Anfrage. Ist der OAuth-Server im Testprojekt aus, werden die Schritte mit echter Anfrage
 * übersprungen.
 */
import { expect, test } from "@playwright/test";
import { assertTestBackend } from "../guard";
import { oauthMetadata, pkce, registerClient, startAuthorization } from "../support/oauth";
import { userClient } from "../support/supabase-node";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { storedAccessToken } from "./support/session";

const env = assertTestBackend();
const CALLBACK = "/oauth-test-callback";

/** Anfrage wie ein MCP-Client starten; null, wenn der OAuth-Server aus ist. */
async function newRequest(baseURL: string, label: string) {
  const meta = await oauthMetadata(env);
  if (!meta) return null;
  const name = uniqueName(label);
  const redirectUri = `${baseURL}${CALLBACK}`;
  const { clientId } = await registerClient(meta, name, redirectUri);
  const { challenge } = pkce();
  const { authorizationId } = await startAuthorization(meta, {
    clientId,
    redirectUri,
    challenge,
    state: "e2e",
  });
  return { name, clientId, authorizationId };
}

/** Freigaben des Clients in ai_clients (mit der Sitzung des Testnutzers). */
async function allowedRows(clientId: string) {
  const db = userClient(await storedAccessToken());
  const { data } = await db.from("ai_clients").select("name, revoked_at").eq("client_id", clientId);
  return data ?? [];
}

test.describe("KI-Zugang erlauben", () => {
  test.use({ storageState: AUTH_FILE });

  test("ohne Anfrage: Hinweis, wie die Seite entsteht; axe, kein Überlauf", async ({ page }) => {
    await page.goto("/ki-zugang");
    await expect(page.getByRole("heading", { name: "Zugang für KI erlauben" })).toBeVisible();
    await expect(page.getByText(/öffnet sich, wenn du in Claude oder ChatGPT/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });

  test("echte Anfrage: Client und Ziel sichtbar, Erlauben gibt frei und leitet mit Code zurück", async ({
    page,
    baseURL,
  }) => {
    const request = await newRequest(baseURL as string, "Claude-Test");
    test.skip(!request, "OAuth-Server im Testprojekt aus");
    if (!request) return;
    await page.goto(`/ki-zugang?authorization_id=${request.authorizationId}`);
    await expect(page.getByTestId("consent-client")).toHaveText(
      `${request.name} möchte mit deinem Triskel arbeiten und kehrt danach zu localhost:3100 zurück.`,
    );
    await expect(page.getByRole("list", { name: "Darf" })).toContainText("Endgültig löschen");
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Erlauben" }).click();
    await page.waitForURL(new RegExp(`${CALLBACK}\\?.*code=`));
    expect(new URL(page.url()).searchParams.get("state")).toBe("e2e");
    expect(await allowedRows(request.clientId)).toEqual([{ name: request.name, revoked_at: null }]);
  });

  test("Ablehnen leitet mit access_denied zurück, ohne Freigabe", async ({ page, baseURL }) => {
    const request = await newRequest(baseURL as string, "Abgelehnt");
    test.skip(!request, "OAuth-Server im Testprojekt aus");
    if (!request) return;
    await page.goto(`/ki-zugang?authorization_id=${request.authorizationId}`);
    await page.getByRole("button", { name: "Ablehnen" }).click();
    await page.waitForURL(new RegExp(`${CALLBACK}\\?.*error=access_denied`));
    expect(await allowedRows(request.clientId)).toEqual([]);
  });
});

test("ohne Anmeldung: erst Login, die Anfrage bleibt im Rücksprung", async ({ page }) => {
  await page.goto("/ki-zugang?authorization_id=abc-123");
  await expect(page).toHaveURL(/\/login\?next=%2Fki-zugang%3Fauthorization_id%3Dabc-123$/);
});

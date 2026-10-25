import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFailedMessage, uploadStatus } from "@/features/outliner/extensions/media-utils";
import {
  browserMediaApi,
  fetchMedia,
  isUnavailable,
  MediaError,
  mediaExists,
  putMedia,
} from "./media-api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const U = "11111111-1111-4111-8111-111111111111";

describe("Dateispeicher im Browser (E41)", () => {
  it("fasst gleichzeitige Link-Anfragen zu einer Anfrage zusammen und holt die Bytes von R2", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/dateien/links") {
        const { items } = JSON.parse(String(init?.body)) as {
          items: Array<{ bucket: string; path: string }>;
        };
        return json({
          links: items.map((i) => ({ ...i, url: `https://r2.example/${i.path}?sig=1` })),
        });
      }
      return new Response(`inhalt:${url}`, { status: 200 });
    });
    const [a, b] = await Promise.all([
      fetchMedia("note-images", `${U}/n/a.png`),
      fetchMedia("attachments", `${U}/n/b.pdf`),
    ]);
    expect(await a.text()).toContain("a.png");
    expect(await b.text()).toContain("b.pdf");
    const linkCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/dateien/links");
    expect(linkCalls).toHaveLength(1);
    expect(JSON.parse(String(linkCalls[0]?.[1]?.body)).items).toHaveLength(2);
  });

  it("503 (R2 nicht eingerichtet) wird ruhig als Fehler mit Status gemeldet", async () => {
    fetchMock.mockResolvedValue(json({ error: "Dateien sind hier nicht verfügbar." }, 503));
    const error = await fetchMedia("note-images", `${U}/n/x.png`).catch((e) => e);
    expect(error).toBeInstanceOf(MediaError);
    expect(isUnavailable(error)).toBe(true);
    expect(uploadFailedMessage("x.png", error)).toContain("nicht verfügbar");
  });

  it("Hochladen: Link anfordern, dann PUT mit genau dem Typ aus den Headern", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/dateien/hochladen"
        ? json({
            path: `${U}/n/${U}.png`,
            url: "https://r2.example/put",
            headers: { "content-type": "image/png" },
          })
        : new Response(null, { status: 200 }),
    );
    const blob = new Blob(["abc"], { type: "image/png" });
    await putMedia(
      { bucket: "note-images", ownerId: "n" },
      `${U}/n/${U}.png`,
      blob,
      "image/png",
      "x.png",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ bucket: "note-images", ownerId: "n", size: 3, id: U });
    const put = fetchMock.mock.calls[1];
    expect(put?.[0]).toBe("https://r2.example/put");
    expect(put?.[1]).toMatchObject({ method: "PUT", headers: { "content-type": "image/png" } });
  });

  it("Ablehnung der Route nennt den Grund; fehlende Antwort hat keinen Status (#72)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Die Datei ist größer als 10 MB." }, 400));
    const refused = await putMedia(
      { bucket: "note-images", ownerId: "n" },
      `${U}/n/${U}.png`,
      new Blob(["x"]),
      "image/png",
      "x.png",
    ).catch((e) => e);
    expect(uploadStatus(refused)).toBe(400);
    expect(uploadFailedMessage("x.png", refused)).toContain("größer als 10 MB");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const lost = await putMedia(
      { bucket: "attachments", ownerId: "n" },
      `${U}/n/${U}.pdf`,
      new Blob(["x"]),
      "application/pdf",
      "x.pdf",
    ).catch((e) => e);
    expect(uploadStatus(lost)).toBeNull();
  });

  it("Besitzer noch nicht gespeichert (404): kurz wiederholen, dann gelingt es", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "Eintrag nicht gefunden." }, 404))
      .mockResolvedValueOnce(
        json({ path: `${U}/n/${U}.png`, url: "https://r2.example/put", headers: {} }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await putMedia(
      { bucket: "note-images", ownerId: "n" },
      `${U}/n/${U}.png`,
      new Blob(["x"]),
      "image/png",
      "x.png",
      [0, 0],
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockReset().mockResolvedValue(json({ error: "Eintrag nicht gefunden." }, 404));
    const error = await putMedia(
      { bucket: "note-images", ownerId: "n" },
      `${U}/n/${U}.png`,
      new Blob(["x"]),
      "image/png",
      "x.png",
      [0],
    ).catch((e) => e);
    expect(uploadStatus(error)).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("R2-PUT-Fehler trägt den Status; Nachfrage und Auflisten laufen über die Routen", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ path: `${U}/n/${U}.pdf`, url: "https://r2.example/p", headers: {} }),
      )
      .mockResolvedValueOnce(new Response("no", { status: 403 }));
    const error = await putMedia(
      { bucket: "attachments", ownerId: "n" },
      `${U}/n/${U}.pdf`,
      new Blob(["x"]),
      "application/pdf",
      "x.pdf",
    ).catch((e) => e);
    expect(uploadStatus(error)).toBe(403);

    fetchMock.mockResolvedValueOnce(json({ exists: true }));
    expect(await mediaExists("attachments", `${U}/n/a.pdf`)).toBe(true);
    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 502));
    expect(await mediaExists("attachments", `${U}/n/a.pdf`)).toBe(false);

    fetchMock.mockResolvedValueOnce(json({ paths: ["p1"] }));
    expect(await browserMediaApi.list("attachments", "n")).toEqual(["p1"]);
    fetchMock.mockResolvedValueOnce(json({ removed: 1 }));
    await browserMediaApi.remove("attachments", ["p1"]);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/dateien/loeschen");
  });
});

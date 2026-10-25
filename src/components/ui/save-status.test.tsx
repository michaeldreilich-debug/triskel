// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveQueueSnapshot } from "@/lib/save-queue/save-queue";
import { SaveStatus } from "./save-status";

const base: SaveQueueSnapshot = {
  status: "idle",
  pending: 0,
  failed: 0,
  attempts: 0,
  lastError: null,
  lastSavedAt: null,
  storageError: false,
};

afterEach(cleanup);

describe("Speicherstatus-Anzeige", () => {
  it.each([
    ["idle", "Gespeichert"],
    ["pending", "Ungespeicherte Änderungen"],
    ["saving", "Speichert …"],
    ["retrying", "Speichern wird wiederholt"],
    ["offline", "Offline – wird nachgeholt"],
    ["error", "Nicht gespeichert"],
  ] as const)("%s → „%s“", (status, label) => {
    render(<SaveStatus snapshot={{ ...base, status }} />);
    expect(screen.getByRole("status").textContent).toContain(label);
  });

  it("bietet bei Fehlern „Erneut versuchen“ an und meldet volles localStorage", () => {
    const onRetry = vi.fn();
    render(
      <SaveStatus
        snapshot={{ ...base, status: "error", failed: 1, storageError: true }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("lokale Sicherung voll");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("bietet bei Fehlern „Verwerfen“ an (D-4)", () => {
    const onDiscard = vi.fn();
    render(
      <SaveStatus
        snapshot={{ ...base, status: "error", failed: 2 }}
        onRetry={() => {}}
        onDiscard={onDiscard}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2 Änderungen verwerfen" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});

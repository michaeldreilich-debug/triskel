import { describe, expect, it } from "vitest";
import { parsePendingSettings } from "./pending";

describe("parsePendingSettings (Theme/Bereich vor dem Laden gewählt, N4)", () => {
  it("liest Theme und Bereich", () => {
    expect(
      parsePendingSettings(
        JSON.stringify({ theme: "paper", active_area_id: "0b9d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4" }),
      ),
    ).toEqual({ theme: "paper", active_area_id: "0b9d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4" });
    // „Alles“ = kein Bereich
    expect(parsePendingSettings(JSON.stringify({ active_area_id: null }))).toEqual({
      active_area_id: null,
    });
  });

  it("verwirft Unbekanntes und Kaputtes", () => {
    expect(parsePendingSettings(null)).toEqual({});
    expect(parsePendingSettings("{kaputt")).toEqual({});
    expect(parsePendingSettings("42")).toEqual({});
    expect(
      parsePendingSettings(
        JSON.stringify({ theme: "neon", active_area_id: "<script>", evening_time: "05:00" }),
      ),
    ).toEqual({});
  });
});

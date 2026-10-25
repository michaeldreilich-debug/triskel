import { describe, expect, it } from "vitest";
import {
  detectPreset,
  nextDueDate,
  presetToRule,
  reanchorRule,
  recurrenceLabel,
  shiftScheduledAt,
  uncheckBody,
} from "./recurrence";

describe("Vorgaben → RRULE", () => {
  // 11.10.2026 ist ein Sonntag
  it("erzeugt Regeln mit Wochentag bzw. Monatstag der Fälligkeit", () => {
    expect(presetToRule("none", "2026-10-11")).toBeNull();
    expect(presetToRule("daily", "2026-10-11")).toBe("FREQ=DAILY");
    expect(presetToRule("weekdays", "2026-10-11")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(presetToRule("weekly", "2026-10-11")).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(presetToRule("biweekly", "2026-10-14")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
    expect(presetToRule("monthly", "2026-10-12")).toBe("FREQ=MONTHLY;BYMONTHDAY=12");
    expect(presetToRule("monthly", "2026-10-31")).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1",
    );
    expect(presetToRule("yearly", "2026-10-11")).toBe("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=11");
  });

  it("erkennt Vorgaben wieder und beschriftet sie", () => {
    for (const preset of [
      "daily",
      "weekdays",
      "weekly",
      "biweekly",
      "monthly",
      "yearly",
    ] as const) {
      expect(detectPreset(presetToRule(preset, "2026-10-31"))).toBe(preset);
    }
    expect(detectPreset(null)).toBe("none");
    expect(detectPreset("RRULE:FREQ=DAILY")).toBe("daily");
    expect(detectPreset("FREQ=DAILY;INTERVAL=3")).toBe("custom");
    expect(recurrenceLabel("FREQ=WEEKLY;BYDAY=SU")).toBe("Wöchentlich (So)");
    expect(recurrenceLabel("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE")).toBe("Alle 2 Wochen (Mi)");
    expect(recurrenceLabel("FREQ=MONTHLY;BYMONTHDAY=12")).toBe("Monatlich (am 12.)");
    expect(recurrenceLabel(presetToRule("monthly", "2026-10-31"))).toBe(
      "Monatlich (am 31. oder Monatsletzten)",
    );
    expect(recurrenceLabel("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=7")).toBe("Jährlich (07.03.)");
    expect(recurrenceLabel("FREQ=DAILY;INTERVAL=3")).toBe("Eigene Regel");
  });

  it("zieht Wochentag/Monatstag mit, wenn sich die Fälligkeit ändert", () => {
    expect(reanchorRule("FREQ=WEEKLY;BYDAY=SU", "2026-10-14")).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(reanchorRule("FREQ=DAILY", "2026-10-14")).toBe("FREQ=DAILY");
    expect(reanchorRule("FREQ=DAILY;INTERVAL=3", "2026-10-14")).toBe("FREQ=DAILY;INTERVAL=3");
    expect(reanchorRule(null, "2026-10-14")).toBeNull();
  });
});

describe("nächster Termin (E12: erster Termin nach max(Fälligkeit, heute))", () => {
  it("pünktlich erledigt: nächster Termin nach der Fälligkeit", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SU", "2026-10-11", "2026-10-11")).toBe("2026-10-18");
    expect(nextDueDate("FREQ=DAILY", "2026-10-11", "2026-10-11")).toBe("2026-10-12");
  });

  it("verspätet erledigt: nach heute, nicht nach der alten Fälligkeit", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SU", "2026-10-04", "2026-10-13")).toBe("2026-10-18");
    expect(nextDueDate("FREQ=DAILY", "2026-10-01", "2026-10-13")).toBe("2026-10-14");
  });

  it("früher erledigt: nach der Fälligkeit, nicht nach heute", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SU", "2026-10-11", "2026-10-09")).toBe("2026-10-18");
  });

  it("ohne Fälligkeit: ab heute", () => {
    expect(nextDueDate("FREQ=DAILY", null, "2026-10-11")).toBe("2026-10-12");
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", null, "2026-10-09")).toBe("2026-10-12");
  });

  it("über die Zeitumstellung am 25.10.2026 ohne Verschiebung", () => {
    expect(nextDueDate("FREQ=DAILY", "2026-10-24", "2026-10-24")).toBe("2026-10-25");
    expect(nextDueDate("FREQ=DAILY", "2026-10-25", "2026-10-25")).toBe("2026-10-26");
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SU", "2026-10-18", "2026-10-18")).toBe("2026-10-25");
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SU", "2026-10-25", "2026-10-25")).toBe("2026-11-01");
    // Frühjahr 2027
    expect(nextDueDate("FREQ=DAILY", "2027-03-27", "2027-03-27")).toBe("2027-03-28");
  });

  it("alle 2 Wochen ab dem Bezugstag, Monatsletzter, jährlich, Schaltjahr", () => {
    expect(nextDueDate("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", "2026-10-14", "2026-10-14")).toBe(
      "2026-10-28",
    );
    // verspätet: der Zwei-Wochen-Takt bleibt am Bezugstag ausgerichtet
    expect(nextDueDate("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", "2026-10-14", "2026-10-20")).toBe(
      "2026-10-28",
    );
    const lastDay = presetToRule("monthly", "2027-01-31");
    expect(nextDueDate(lastDay, "2027-01-31", "2027-01-31")).toBe("2027-02-28");
    expect(nextDueDate(lastDay, "2027-02-28", "2027-02-28")).toBe("2027-03-31");
    expect(nextDueDate("FREQ=MONTHLY;BYMONTHDAY=12", "2026-10-12", "2026-10-12")).toBe(
      "2026-11-12",
    );
    expect(nextDueDate("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=11", "2026-10-11", "2026-10-11")).toBe(
      "2027-10-11",
    );
    expect(nextDueDate(presetToRule("monthly", "2028-01-29"), "2028-01-29", "2028-01-29")).toBe(
      "2028-02-29",
    );
  });

  it("ungültige Regel → null", () => {
    expect(nextDueDate("FREQ=KAPUTT", "2026-10-11", "2026-10-11")).toBeNull();
    expect(nextDueDate(null, "2026-10-11", "2026-10-11")).toBeNull();
  });
});

describe("Folgeinstanz", () => {
  it("„geplant für“ behält die Berliner Uhrzeit, auch über den 25.10.2026", () => {
    // 24.10. 09:00 Sommerzeit (07:00 UTC) → 25.10. 09:00 Winterzeit (08:00 UTC)
    expect(shiftScheduledAt("2026-10-24T07:00:00Z", "2026-10-24", "2026-10-25")).toBe(
      "2026-10-25T08:00:00.000Z",
    );
    expect(shiftScheduledAt("2026-10-18T18:30:00Z", "2026-10-18", "2026-10-25")).toBe(
      "2026-10-25T19:30:00.000Z",
    );
    expect(shiftScheduledAt(null, "2026-10-24", "2026-10-25")).toBeNull();
    expect(shiftScheduledAt("2026-10-24T07:00:00Z", null, "2026-10-25")).toBeNull();
  });

  it("Checklisten-Punkte starten unerledigt", () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] },
          ],
        },
      ],
    };
    const result = uncheckBody(body);
    expect(JSON.stringify(result)).not.toContain('"checked":true');
    expect(result?.content?.[0]?.content?.[0]?.attrs?.checked).toBe(false);
    expect(body.content[0]?.content[0]?.attrs.checked).toBe(true);
    expect(uncheckBody(null)).toBeNull();
  });
});

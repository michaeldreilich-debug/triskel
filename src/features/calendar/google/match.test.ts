import { describe, expect, it } from "vitest";
import { calendarIdFromIcalUrl, icalReplacedByGoogle, sameCalendarId } from "./match";

const ical = (id: string) =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/private-abc123/basic.ics`;

describe("Kalender-ID aus der geheimen iCal-Adresse", () => {
  it("liest die ID (kodiertes @ und #) aus https://calendar.google.com/calendar/ical/<ID>/…", () => {
    expect(calendarIdFromIcalUrl(ical("alex@gmail.com"))).toBe("alex@gmail.com");
    expect(calendarIdFromIcalUrl(ical("de.german#holiday@group.v.calendar.google.com"))).toBe(
      "de.german#holiday@group.v.calendar.google.com",
    );
    expect(calendarIdFromIcalUrl(new URL(ical("abc@group.calendar.google.com")))).toBe(
      "abc@group.calendar.google.com",
    );
    expect(calendarIdFromIcalUrl(`  ${ical("x@gmail.com")}\n`)).toBe("x@gmail.com");
  });

  it("andere Adressen → null", () => {
    for (const bad of [
      "http://localhost:3100/dev/ics?name=probe",
      "https://calendar.google.com/calendar/embed?src=x",
      "https://calendar.google.com.evil.example/calendar/ical/x@gmail.com/basic.ics",
      "https://calendar.google.com/calendar/ical/",
      "https://calendar.google.com/calendar/ical/%E0%A4%A/basic.ics",
      "kein link",
      "",
    ]) {
      expect(calendarIdFromIcalUrl(bad), bad).toBeNull();
    }
  });

  it("vergleicht IDs ohne Groß/Klein", () => {
    expect(sameCalendarId("Alex@Gmail.com", "alex@gmail.com ")).toBe(true);
    expect(sameCalendarId("a@gmail.com", "b@gmail.com")).toBe(false);
  });
});

describe("iCal-Quellen, die ein eingeschalteter Google-Kalender ersetzt", () => {
  const sources = [
    { id: "s1", url: ical("Alex@gmail.com") },
    { id: "s2", url: ical("beruf@group.calendar.google.com") },
    { id: "s3", url: "http://localhost:3100/dev/ics?name=probe" },
    { id: "s4", url: "" },
  ];

  it("ordnet über die ID in der Adresse zu (Groß/Klein egal), nur eingeschaltete Kalender", () => {
    const replaced = icalReplacedByGoogle(sources, ["alex@gmail.com"]);
    expect([...replaced]).toEqual([["s1", "alex@gmail.com"]]);
  });

  it("mehrere Kalender; ohne Google-Kalender nichts", () => {
    expect(
      [
        ...icalReplacedByGoogle(sources, [
          "alex@gmail.com",
          "beruf@group.calendar.google.com",
          "anderer@gmail.com",
        ]),
      ].sort(),
    ).toEqual([
      ["s1", "alex@gmail.com"],
      ["s2", "beruf@group.calendar.google.com"],
    ]);
    expect(icalReplacedByGoogle(sources, []).size).toBe(0);
  });
});

import { Extension, InputRule } from "@tiptap/core";
import { berlinDate, berlinTime, formatDateShort } from "@/lib/dates";

/**
 * Zeitstempel per Kürzel (Rückmeldung 17.10.2026): „@jetzt“ + Leertaste wird „17.10.2026 20:45“,
 * „@heute“ + Leertaste das Datum – Europe/Berlin, als normaler Text (durchsuchbar, im Export).
 * In Notiz, Aufgaben-Notiz und Projekt-Freitext; dazu „Zeitstempel einfügen“ im Rechtsklick-Menü.
 */
export type TimestampKind = "jetzt" | "heute";

export function timestampText(kind: TimestampKind, now = new Date()): string {
  const date = formatDateShort(berlinDate(now));
  return kind === "heute" ? date : `${date} ${berlinTime(now)}`;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    timestamp: {
      /** Zeitstempel an der Markierung einsetzen (ersetzt sie) */
      insertTimestamp: (kind?: TimestampKind) => ReturnType;
    };
  }
}

export const Timestamp = Extension.create({
  name: "timestamp",

  addCommands() {
    return {
      insertTimestamp:
        (kind = "jetzt") =>
        ({ commands }) =>
          commands.insertContent(`${timestampText(kind)} `),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(@(jetzt|heute))\s$/i,
        handler: ({ state, range, match }) => {
          const kind = (match[2] as string).toLowerCase() as TimestampKind;
          // führendes Leerzeichen bleibt stehen, das getippte am Ende kommt hinter den Stempel
          const from = range.from + (match[0] as string).indexOf("@");
          state.tr.insertText(`${timestampText(kind)} `, from, range.to);
        },
      }),
    ];
  },
});

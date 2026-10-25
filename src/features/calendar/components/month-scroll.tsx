"use client";

/**
 * Monat auf /kalender zum Durchscrollen (#85, wie Notion Kalender): ein durchgehendes
 * Wochenraster, das in sich scrollt; die Wochentage bleiben oben stehen. „Dran“ ist der Monat mit
 * den meisten sichtbaren Tagen (`dominantMonth`): volle Farbe, Überschrift und Adresse
 * (`onMonth`), die übrigen gedämpft; am 1. steht der Monat. Nähert sich das Bild einem Ende, hängt
 * die Seite Monate an (`onExtend`) – die oberste sichtbare Woche bleibt dabei stehen, auch wenn
 * später Termine nachladen. Kommt der Monat nicht vom Scrollen (←/→, Heute, Link), scrollt das
 * Raster zu ihm: zur Woche mit dem 1., ist heute in dem Monat, bis die laufende Woche im Bild ist.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/features/tasks/peek";
import { cn } from "@/lib/cn";
import { type IsoDate, isoWeekRange } from "@/lib/dates";
import { type CalendarDay, dominantMonth, monthOf, monthsBetween } from "../model";
import { useCalendar } from "./calendar-context";
import { DayHeader, DayList, dayNumber, useFillHeight, weekdayLabel } from "./day-parts";
import { MonthCell, useScrollbarWidth, WEEKDAYS } from "./views";

/** Vorlauf zum Nachladen: so viele Bildhöhen vor einem Ende */
const EDGE_SCREENS = 1;
/** so lange ohne Scroll-Ereignis gilt ein angestoßenes Scrollen als fertig (ms); `scrollend` kennt Safari nicht */
const SETTLE_MS = 150;
/** weiche Bewegung nur über kurze Strecken (Monate), weiter springt das Raster */
const SMOOTH_MONTHS = 2;

const weekRows = (element: HTMLElement) => element.querySelectorAll<HTMLElement>("[data-week]");

export function MonthScroll({
  days,
  month,
  onMonth,
  onExtend,
  onPickDay,
}: {
  /** ganze Wochen (Mo–So) des Fensters */
  days: CalendarDay[];
  /** Monat aus der Adresse („JJJJ-MM-01“) */
  month: IsoDate;
  /** der Monat im Bild hat durchs Scrollen gewechselt */
  onMonth: (month: IsoDate) => void;
  /** nahe an einem Ende: Monate davor (−1) bzw. danach (1) anhängen */
  onExtend: (direction: -1 | 1) => void;
  onPickDay: (date: IsoDate) => void;
}) {
  const { today } = useCalendar();
  const wide = useMediaQuery("(min-width: 768px)");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const scroller = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const height = useFillHeight(scroller, { gap: 40, min: 320 });
  const gutter = useScrollbarWidth(scroller);
  const [focus, setFocus] = useState(month);
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const pickedDay = days.find((d) => d.date === picked) ?? null;
  const weeks = useMemo(() => {
    const out: CalendarDay[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  /** oberste sichtbare Woche und ihr Abstand zum oberen Rand – bleibt beim Nachladen stehen */
  const anchor = useRef<{ week: string; offset: number } | null>(null);
  /** Ziel eines angestoßenen Scrollens; solange gesetzt, meldet das Raster keinen Monat */
  const target = useRef<IsoDate | null>(null);
  const settle = useRef<number | undefined>(undefined);
  const extending = useRef(false);
  /** zuletzt gemeldeter bzw. angesteuerter Monat */
  const shown = useRef<IsoDate | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const frame = useRef(0);

  const capture = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    for (const row of weekRows(element)) {
      if (row.offsetTop + row.offsetHeight > element.scrollTop) {
        anchor.current = {
          week: row.dataset.week ?? "",
          offset: row.offsetTop - element.scrollTop,
        };
        return;
      }
    }
  }, []);

  const restore = useCallback(() => {
    const element = scroller.current;
    const spot = anchor.current;
    if (!element || !spot) return;
    const row = element.querySelector<HTMLElement>(`[data-week="${spot.week}"]`);
    if (row) element.scrollTop = row.offsetTop - spot.offset;
  }, []);

  const checkEdges = useCallback(() => {
    const element = scroller.current;
    if (!element || extending.current || target.current) return;
    const margin = element.clientHeight * EDGE_SCREENS;
    if (element.scrollTop < margin) {
      extending.current = true;
      onExtend(-1);
    } else if (element.scrollHeight - element.scrollTop - element.clientHeight < margin) {
      extending.current = true;
      onExtend(1);
    }
  }, [onExtend]);

  /** angestoßenes Scrollen ist fertig, wenn eine Weile kein Scroll-Ereignis mehr kommt */
  const settleLater = useCallback(() => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      target.current = null;
      capture();
      checkEdges();
    }, SETTLE_MS);
  }, [capture, checkEdges]);

  /** Monat im Bild aus den sichtbaren Wochen */
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    const visible: Array<{ start: IsoDate; visible: number }> = [];
    for (const row of weekRows(element)) {
      const from = Math.max(top, row.offsetTop);
      const to = Math.min(bottom, row.offsetTop + row.offsetHeight);
      if (to > from && row.offsetHeight > 0) {
        visible.push({ start: row.dataset.week ?? "", visible: (to - from) / row.offsetHeight });
      }
    }
    const next = dominantMonth(visible);
    if (!next || next === focusRef.current) return;
    setFocus(next);
    shown.current = next;
    onMonth(next);
  }, [onMonth]);

  const scrollToMonth = useCallback(
    (goal: IsoDate, smooth: boolean) => {
      const element = scroller.current;
      if (!element) return;
      const first = element.querySelector<HTMLElement>(`[data-week="${isoWeekRange(goal).start}"]`);
      if (!first) return;
      let top = first.offsetTop;
      if (today && monthOf(today) === goal) {
        const now = element.querySelector<HTMLElement>(
          `[data-week="${isoWeekRange(today).start}"]`,
        );
        const end = now ? now.offsetTop + now.offsetHeight : 0;
        if (end > top + element.clientHeight) top = end - element.clientHeight;
      }
      target.current = goal;
      setFocus(goal);
      element.scrollTo({ top, behavior: smooth ? "smooth" : "instant" });
      settleLater();
    },
    [today, settleLater],
  );

  // Fenster vorn verlängert oder gekürzt: die oberste Woche bleibt, wo sie war
  const firstDate = days[0]?.date;
  const lastDate = days.at(-1)?.date;
  useLayoutEffect(() => {
    if (!firstDate || !lastDate) return;
    if (!target.current) restore();
    extending.current = false;
  }, [firstDate, lastDate, restore]);

  // Monat aus der Adresse, der nicht vom Scrollen kommt: dorthin scrollen (beim Öffnen sofort)
  const sized = !wide || height !== undefined;
  useLayoutEffect(() => {
    if (!sized || month === shown.current) return;
    const first = shown.current === null;
    shown.current = month;
    const near = Math.abs(monthsBetween(focusRef.current, month)) <= SMOOTH_MONTHS;
    scrollToMonth(month, !first && near && !reduceMotion);
  }, [month, sized, reduceMotion, scrollToMonth]);

  // Zeilen ändern ihre Höhe (Termine laden nach, Schrift, Breite): Stelle halten bzw. Ziel nachführen
  useEffect(() => {
    const element = list.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (target.current) scrollToMonth(target.current, false);
      else restore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [restore, scrollToMonth]);

  useEffect(
    () => () => {
      window.clearTimeout(settle.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = () => {
    // sofort merken, nicht erst im nächsten Bild: lädt dazwischen etwas nach, stimmt die Stelle
    capture();
    if (target.current) {
      settleLater();
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      measure();
      checkEdges();
    });
  };
  // eigenes Scrollen (Rad, Finger, Tasten) beendet ein angestoßenes sofort
  const takeOver = () => {
    if (!target.current) return;
    target.current = null;
    window.clearTimeout(settle.current);
  };

  return (
    <div className="flex flex-col gap-4" data-calendar-view="monat">
      <div className="flex flex-col">
        <div
          className="grid grid-cols-7 border-b border-border pb-1"
          style={{ paddingRight: gutter }}
        >
          {WEEKDAYS.map((w) => (
            <span key={w} className="px-1 text-meta uppercase tracking-widest text-faint">
              {w}
            </span>
          ))}
        </div>
        <section
          ref={scroller}
          aria-label="Monate"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll-Container muss per Tastatur scrollbar sein
          tabIndex={0}
          onScroll={onScroll}
          onWheel={takeOver}
          onTouchStart={takeOver}
          onKeyDown={takeOver}
          // eigenes Halten der Stelle (siehe oben) statt des Browsers – Safari kann es nicht
          className={cn(
            "scroll-quiet relative overflow-y-auto [overflow-anchor:none]",
            !wide && "max-h-[22.75rem]",
          )}
          style={wide ? { maxHeight: height ?? "70dvh" } : undefined}
          data-month-scroll
        >
          <div ref={list} className="flex flex-col gap-px overflow-hidden rounded-card bg-border">
            {weeks.map((week) => (
              <div
                key={week[0]?.date}
                data-week={week[0]?.date}
                className="grid grid-cols-7 gap-px"
              >
                {week.map((day) => (
                  <MonthCell
                    key={day.date}
                    day={day}
                    outside={!day.date.startsWith(focus.slice(0, 7))}
                    compact={!wide}
                    picked={picked === day.date}
                    withMonth
                    onPick={() => {
                      if (wide) onPickDay(day.date);
                      else setPicked(picked === day.date ? null : day.date);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
      {!wide && pickedDay ? (
        <section
          aria-label={`${weekdayLabel(pickedDay, true)} ${dayNumber(pickedDay.date)}.`}
          className="flex flex-col gap-2"
        >
          <DayHeader day={pickedDay} variant="row" />
          <DayList day={pickedDay} />
        </section>
      ) : null}
    </div>
  );
}

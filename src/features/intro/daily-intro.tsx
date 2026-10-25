"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HOME_PATH } from "@/lib/auth/routes";
import { berlinDate } from "@/lib/dates";
import {
  AFTER_FLASH,
  FUSE_MS,
  INTRO_KEYS,
  INTRO_PLAY_EVENT,
  INTRO_TEXT,
  INTRO_VIDEO,
  introDue,
  LEAVE_MS,
  REVEAL_AT,
  revealedCount,
} from "./model";

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // kein Speicher (privates Fenster): dann eben bei jedem Öffnen von Heute
  }
}

/**
 * Startbild (E45) in der App-Hülle: erscheint beim ersten Aufruf von Heute an jedem Tag (je
 * Gerät, abschaltbar in Einstellungen › Startbild) und auf Wunsch von dort aus. Es endet immer in
 * der Seite darunter – beim täglichen Start ist das Heute.
 */
export function DailyIntro() {
  const pathname = usePathname();
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (pathname !== HOME_PATH) return;
    const today = berlinDate();
    const due = introDue({
      enabled: readKey(INTRO_KEYS.enabled) !== "0",
      lastShown: readKey(INTRO_KEYS.lastShown),
      today,
      automated: navigator.webdriver === true,
      testEnabled: readKey(INTRO_KEYS.test) === "1",
    });
    if (!due) return;
    writeKey(INTRO_KEYS.lastShown, today);
    setRun((n) => n + 1);
  }, [pathname]);

  useEffect(() => {
    const play = () => setRun((n) => n + 1);
    window.addEventListener(INTRO_PLAY_EVENT, play);
    return () => window.removeEventListener(INTRO_PLAY_EVENT, play);
  }, []);

  const close = useCallback(() => setRun(0), []);
  return run > 0 ? <IntroOverlay key={run} onDone={close} /> : null;
}

function IntroOverlay({ onDone }: { onDone: () => void }) {
  const heroId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Standbild statt Video: bei „Bewegung reduzieren“ oder wenn das Video nicht abspielt
  const [still, setStill] = useState(reduced);
  const [count, setCount] = useState(reduced ? REVEAL_AT.length : 0);
  const [leaving, setLeaving] = useState(false);
  const allShown = count >= REVEAL_AT.length;

  const leave = useCallback(() => setLeaving(true), []);
  const showAll = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused && video.currentTime < AFTER_FLASH) video.currentTime = AFTER_FLASH;
    setCount(REVEAL_AT.length);
  }, []);

  // Die Zeilen folgen der Zeit im Video; spielt es nicht, läuft eine eigene Uhr.
  useEffect(() => {
    if (reduced) return;
    const video = videoRef.current;
    if (!video) return;
    let clock: number | null = null;
    let raf = 0;
    const tick = () => {
      const t = clock === null ? video.currentTime : (performance.now() - clock) / 1000;
      const next = revealedCount(t);
      setCount((c) => Math.max(c, next));
      if (next < REVEAL_AT.length) raf = requestAnimationFrame(tick);
    };
    video.muted = true;
    video.play().catch(() => {
      clock = performance.now() - (REVEAL_AT[0] - 0.6) * 1000;
      setStill(true);
    });
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  useEffect(() => {
    if (!allShown || leaving) return;
    const id = window.setTimeout(leave, FUSE_MS);
    return () => window.clearTimeout(id);
  }, [allShown, leaving, leave]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(onDone, LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving, onDone]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (leaving) return;
    const onKey = (event: KeyboardEvent) => {
      const onButton = event.target instanceof Element && event.target.closest("button");
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        leave();
      } else if ((event.key === "Enter" || event.key === " ") && !onButton) {
        event.preventDefault();
        event.stopPropagation();
        if (allShown) leave();
        else showAll();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [allShown, leaving, leave, showAll]);

  const on = (index: number) => (index < count ? "" : undefined);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Tastatur über den Handler am Dokument (Enter, Leertaste, Escape)
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={heroId}
      tabIndex={-1}
      className="daily-intro"
      data-text={count > 0 ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        if (allShown) leave();
        else showAll();
      }}
    >
      {still ? (
        // biome-ignore lint/performance/noImgElement: Standbild als Hintergrund, kein Inhaltsbild
        <img className="daily-intro-film" src={INTRO_VIDEO.still} alt="" />
      ) : (
        <video
          ref={videoRef}
          className="daily-intro-film"
          src={INTRO_VIDEO.src}
          poster={INTRO_VIDEO.poster}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      )}
      <div className="daily-intro-flash" aria-hidden="true" />
      <div className="daily-intro-stage">
        <div className="daily-intro-verse">
          <div className="daily-intro-group">
            <p id={heroId} className="daily-intro-hero" data-on={on(0)}>
              {INTRO_TEXT.hero}
            </p>
            {INTRO_TEXT.lines.map((line, i) => (
              <p key={line} className="daily-intro-line" data-on={on(1 + i)}>
                {line}
              </p>
            ))}
          </div>
          <div className="daily-intro-goals">
            {INTRO_TEXT.goals.map((goal, i) => (
              <p key={goal.label} className="daily-intro-goal" data-on={on(3 + i)}>
                <span className="daily-intro-goal-label">{goal.label}</span>
                <span className="daily-intro-goal-value">{goal.value}</span>
              </p>
            ))}
          </div>
          <p className="daily-intro-happy" data-on={on(5)}>
            {INTRO_TEXT.happy}
          </p>
          <ul className="daily-intro-pillars" aria-label="Was mich trägt">
            {INTRO_TEXT.pillars.map((pillar, i) => (
              <li key={pillar} className="daily-intro-pillar" data-on={on(6 + i)}>
                {pillar}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="daily-intro-go"
            data-on={on(10)}
            data-fuse={allShown && !leaving ? "" : undefined}
            tabIndex={allShown ? 0 : -1}
            style={{ "--fuse": `${FUSE_MS}ms` } as React.CSSProperties}
            onClick={leave}
          >
            Los geht’s <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <button type="button" className="daily-intro-skip" onClick={leave}>
        Überspringen
      </button>
      <p className="daily-intro-credit">{INTRO_VIDEO.credit}</p>
    </div>
  );
}

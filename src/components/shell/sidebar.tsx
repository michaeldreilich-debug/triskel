"use client";

import { ChevronRight, LogOut, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId } from "react";
import { TriskelMark } from "@/components/triskel-mark";
import { Button, buttonClasses } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { AreaSummary } from "@/features/areas/defaults";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { cn } from "@/lib/cn";
import { useLocalFlag } from "@/lib/local-pref";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { useUi } from "@/lib/ui-store";
import { AreaSwitch } from "./area-switch";
import { LegendButton } from "./legend";
import { DATABASE_NAV, isActive, MAIN_NAV, type NavItem, SETTINGS_NAV, TRASH_NAV } from "./nav";
import { FoldButton } from "./wide";

/** Zeilen der Seitenleiste: kompakt am Mac (28 px, #29), am Handy 44 px Touch-Ziel. */
export const navItemClasses = (active: boolean, tone: "accent" | "quiet" = "accent") =>
  cn(
    "flex min-h-11 items-center gap-2 rounded-control px-2 text-ui transition-colors md:min-h-6.5 md:text-ui-sm",
    active
      ? tone === "accent"
        ? "bg-accent font-medium text-accent-fg"
        : "bg-surface-2 font-medium text-fg"
      : "text-fg/85 hover:bg-surface-2 hover:text-fg",
  );

function NavLink({
  item,
  pathname,
  onNavigate,
  badge,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  badge?: number;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={navItemClasses(active)}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
      {item.label}
      {badge ? (
        <span
          className={cn(
            "ml-auto text-meta tabular-nums",
            active ? "text-accent-fg/70" : "text-faint",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Symbol-Knopf im Fuß der Seitenleiste (Papierkorb, Einstellungen): eine Zeile statt vier (#29). */
function FooterLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-label={item.label}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(buttonClasses("ghost", "icon-sm"), active && "bg-surface-2 text-fg")}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-8 items-center px-2 text-meta uppercase tracking-widest text-faint md:min-h-5">
      {children}
    </p>
  );
}

/**
 * Abschnitt der Seitenleiste mit Überschrift zum Ein- und Ausklappen (wie bei Notion, #29);
 * der Zustand gilt je Gerät.
 */
export function SidebarSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useLocalFlag(`sz-sidebar-${id}`, true);
  const bodyId = useId();
  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="group flex min-h-11 items-center gap-1 rounded-control px-2 text-left text-meta uppercase tracking-widest text-faint hover:text-muted md:min-h-6"
      >
        <span className="min-w-0 truncate">{title}</span>
        <ChevronRight
          size={12}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "shrink-0 transition-transform md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100",
            open && "rotate-90",
          )}
        />
      </button>
      {/* biome-ignore lint/a11y/useSemanticElements: Gruppe von Links, kein Formular (fieldset passt nicht) */}
      <div
        id={bodyId}
        role="group"
        aria-label={title}
        hidden={!open}
        className="flex flex-col gap-px"
      >
        {children}
      </div>
    </div>
  );
}

/** Abschnitte mit Daten (von AppFrame): aktive Projekte, gespeicherte Ansichten, Zähler. */
export interface SidebarSlots {
  projects?: (onNavigate?: () => void) => React.ReactNode;
  views?: (onNavigate?: () => void) => React.ReactNode;
  /** „Zuletzt bearbeitet“ (#30) */
  recent?: (onNavigate?: () => void) => React.ReactNode;
  /** Zahlen neben Navigationspunkten, z. B. { "/inbox": 3 } */
  badges?: Record<string, number>;
}

export interface SidebarContentProps {
  areas: AreaSummary[];
  areasLoading?: boolean;
  saveStatus?: React.ReactNode;
  onSignOut?: () => Promise<void>;
  /** Desktop: Knopf zum Einklappen anzeigen */
  collapsible?: boolean;
  onNavigate?: () => void;
  slots?: SidebarSlots;
}

export function SidebarContent({
  areas,
  areasLoading,
  saveStatus,
  onSignOut,
  collapsible,
  onNavigate,
  slots,
}: SidebarContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  async function signOut() {
    if (onSignOut) {
      await onSignOut();
    } else if (getSupabaseConfig()) {
      const { createClient } = await import("@/lib/supabase/client");
      // nur diese Sitzung beenden – andere Geräte bleiben angemeldet
      await createClient().auth.signOut({ scope: "local" });
    }
    router.replace(LOGIN_PATH);
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-2.5 pt-3 pb-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <Link
          href="/heute"
          onClick={onNavigate}
          className="flex items-center gap-2 text-heading font-semibold md:text-ui"
        >
          <TriskelMark size={20} className="shrink-0" />
          <span className="heading">Triskel</span>
        </Link>
        {collapsible ? (
          <FoldButton
            label="Seitenleiste"
            onClick={toggleSidebar}
            hint="Seitenleiste einklappen (⌘\)"
            className="md:size-7"
          />
        ) : null}
      </div>

      <AreaSwitch areas={areas} loading={areasLoading} />

      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 justify-start font-normal text-muted"
          onClick={() => setCommandOpen(true)}
        >
          <Search size={15} strokeWidth={1.5} aria-hidden />
          Suche
          <Kbd className="ml-auto">⌘K</Kbd>
        </Button>
        <Button variant="primary" size="sm" onClick={() => setCommandOpen(true)} aria-label="Neu">
          <Plus size={15} strokeWidth={2} aria-hidden />
          <span className="max-md:sr-only">Neu</span>
        </Button>
      </div>

      <nav
        aria-label="Hauptnavigation"
        // enger seit „Kalender“ in der Hauptnavigation (S2b): passt bei 1440×800 weiter ohne Scrollen (#29)
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1"
      >
        <div className="flex flex-col gap-px">
          {MAIN_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
              badge={slots?.badges?.[item.href]}
            />
          ))}
        </div>

        {slots?.projects ? (
          slots.projects(onNavigate)
        ) : (
          <div className="flex flex-col gap-px">
            <SectionLabel>Aktive Projekte</SectionLabel>
            <p className="px-2 text-ui-sm text-faint">Noch keine aktiven Projekte.</p>
          </div>
        )}

        <div className="flex flex-col gap-px">
          <SectionLabel>Datenbanken</SectionLabel>
          {DATABASE_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
              badge={slots?.badges?.[item.href]}
            />
          ))}
        </div>

        {slots?.views?.(onNavigate)}
        {slots?.recent?.(onNavigate)}
      </nav>

      <div className="flex items-center border-t border-border pt-2">
        <div className="min-w-0 flex-1 truncate pl-1.5">{saveStatus}</div>
        <FooterLink item={TRASH_NAV} pathname={pathname} onNavigate={onNavigate} />
        <FooterLink item={SETTINGS_NAV} pathname={pathname} onNavigate={onNavigate} />
        <LegendButton onOpen={onNavigate} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:size-7"
          onClick={signOut}
          aria-label="Abmelden"
          title="Abmelden"
        >
          <LogOut size={16} strokeWidth={1.5} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

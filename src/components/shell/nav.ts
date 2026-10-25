import {
  BookOpen,
  CalendarDays,
  FileText,
  Folder,
  History,
  Inbox,
  type LucideIcon,
  Settings,
  SquareCheck,
  Sun,
  Trash2,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

/** Hauptnavigation (Kalender seit Stufe 2, S2b). */
export const MAIN_NAV: NavItem[] = [
  { href: "/heute", label: "Heute", icon: Sun },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/kalender", label: "Kalender", icon: CalendarDays },
  { href: "/wissen", label: "Wissen", icon: BookOpen },
  { href: "/rueckblicke", label: "Rückblicke", icon: History },
];

export const DATABASE_NAV: NavItem[] = [
  { href: "/projekte", label: "Projekte", icon: Folder },
  { href: "/aufgaben", label: "Aufgaben", icon: SquareCheck },
  { href: "/notizen", label: "Notizen", icon: FileText },
];

/** Unten in der Seitenleiste, neben Darstellung und Abmelden (B13). */
export const TRASH_NAV: NavItem = { href: "/papierkorb", label: "Papierkorb", icon: Trash2 };

/** Einstellungen (B11): Abendzeit, Vorlagen, Export. */
export const SETTINGS_NAV: NavItem = {
  href: "/einstellungen",
  label: "Einstellungen",
  icon: Settings,
};

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

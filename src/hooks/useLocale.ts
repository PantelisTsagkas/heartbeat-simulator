"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { MESSAGES, type Locale, type Messages } from "@/lib/i18n";

const STORAGE_KEY = "heartbeat-locale";
const listeners = new Set<() => void>();
/** Choice made this session. Also covers browsers where storage is blocked. */
let chosen: Locale | null = null;

function readLocale(): Locale {
  if (chosen) return chosen;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "el") return stored;
  } catch {
    // Storage can be blocked. Fall through to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("el") ? "el" : "en";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Current language and its messages. Defaults to the browser language
 * (Greek or English) and remembers an explicit choice.
 */
export function useLocale(): {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
} {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, () => "en");
  const t = MESSAGES[locale];

  const setLocale = useCallback((next: Locale) => {
    chosen = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted, but the in-memory choice still applies.
    }
    listeners.forEach((listener) => listener());
  }, []);

  // Keep the document language right for screen readers and Greek uppercasing.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.appName;
  }, [locale, t]);

  return { locale, t, setLocale };
}

"use client";

import { useSyncExternalStore } from "react";
import { WebHaptics } from "web-haptics";

/*
 * The one place the app makes the phone tap back.
 *
 * `web-haptics` vibrates on Android (navigator.vibrate) and, on iOS Safari, toggles a hidden
 * `<input type="checkbox" switch>` so the Taptic Engine ticks. Desktop browsers simply do nothing.
 *
 * Rules every call site follows:
 * - Call `triggerHaptic()` from a click / change / pointer handler (or right when an async result
 *   that handler awaited arrives), never from scroll, hover, typing or page load.
 * - Haptics only ever echo a visual change; nothing depends on them.
 *
 * Kill switches: `prefers-reduced-motion: reduce`, and the `haptics-enabled` localStorage flag the
 * footer toggle writes (on unless it is "false"). Debug mode (`?haptics-debug=1`, or the
 * `haptics-debug` localStorage key set to "1") plays an audible click instead, so desktop can hear
 * where the taps land.
 */

export type HapticPreset =
  | "success"
  | "warning"
  | "error"
  | "light"
  | "medium"
  | "heavy"
  | "selection"
  | "soft"
  | "rigid"
  | "nudge"
  | "buzz";

const PREF_KEY = "haptics-enabled";
const DEBUG_KEY = "haptics-debug";
const PREF_EVENT = "haptics-preference";

let engine: WebHaptics | null = null;
/** Holds the choice for this page view when localStorage is blocked (private mode, etc.). */
let sessionPref: boolean | null = null;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function debugRequested(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get(DEBUG_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return readStorage(DEBUG_KEY) === "1";
}

/**
 * The library's iOS path clicks a hidden label in <body>. That synthetic click must not reach the
 * app's own document click listeners (outside-click-to-close menus), so it is stopped at the window
 * in the capture phase. Stopping propagation keeps the default action, so the switch still toggles.
 */
function isolateSyntheticClicks() {
  window.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('label[for^="web-haptics-"], input[id^="web-haptics-"]')) {
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}

/** Creates the engine on the client the first time it is needed. */
function getEngine(): WebHaptics | null {
  if (engine) return engine;
  try {
    isolateSyntheticClicks();
    engine = new WebHaptics({ debug: debugRequested() });
  } catch {
    engine = null;
  }
  return engine;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function hapticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionPref !== null) return sessionPref;
  return readStorage(PREF_KEY) !== "false";
}

/**
 * Fires a haptic preset. Safe to call anywhere on the client: it no-ops on the server, on
 * unsupported browsers, under reduced motion, or when the person turned haptics off.
 */
export function triggerHaptic(preset: HapticPreset = "medium"): void {
  if (typeof window === "undefined") return;
  if (!hapticsEnabled() || reducedMotion()) return;
  try {
    const haptics = getEngine();
    if (!haptics) return;
    // Synchronous up to the first pulse, so it stays inside the user gesture.
    void haptics.trigger(preset).catch(() => {});
  } catch {
    /* never let feedback break an interaction */
  }
}

/* ---------- Delegated feedback for selection controls ---------- */

const SELECT_ROLES = '[role="tab"], [role="radio"], [role="menuitemradio"]';
const TOGGLE_ROLES = '[role="switch"], [role="checkbox"], [role="menuitemcheckbox"]';

function inert(el: Element): boolean {
  return (
    el.closest('[data-haptics="off"]') !== null ||
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true
  );
}

/**
 * Every tab, segmented control, radio chip, switch and checkbox in the app (shared or hand-rolled)
 * answers with one listener instead of per-component calls:
 * - tabs / radios tick with "selection", but only when the choice actually changes;
 * - switches / checkboxes give a "light" tap.
 * It listens on the window in the capture phase, so it runs synchronously inside the real click,
 * before React updates the DOM, and reads the state the control had when it was tapped.
 * Opt an element (or a whole region) out with `data-haptics="off"`.
 */
export function installHapticDelegation(): () => void {
  if (typeof window === "undefined") return () => {};

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest) return;

    const choice = target.closest(SELECT_ROLES);
    if (choice) {
      if (inert(choice)) return;
      const already =
        choice.getAttribute("aria-selected") === "true" || choice.getAttribute("aria-checked") === "true";
      if (!already) triggerHaptic("selection");
      return;
    }

    const toggle = target.closest(TOGGLE_ROLES);
    if (toggle && !inert(toggle)) triggerHaptic("light");
  };

  // Native checkboxes and radios report through `change` (a label tap clicks twice otherwise).
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.id.startsWith("web-haptics-")) return; // the engine's own hidden switch
    if (input.type !== "checkbox" && input.type !== "radio") return;
    if (inert(input)) return;
    triggerHaptic(input.type === "radio" ? "selection" : "light");
  };

  window.addEventListener("click", onClick, true);
  window.addEventListener("change", onChange, true);
  return () => {
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("change", onChange, true);
  };
}

/* ---------- Preference (for the footer toggle) ---------- */

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PREF_KEY) return;
    sessionPref = null; // another tab changed it: storage is the source of truth again
    onChange();
  };
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setHapticsEnabled(enabled: boolean): void {
  sessionPref = enabled;
  try {
    window.localStorage.setItem(PREF_KEY, enabled ? "true" : "false");
  } catch {
    /* storage blocked: sessionPref keeps the choice for this page view */
  }
  window.dispatchEvent(new Event(PREF_EVENT));
  if (enabled) triggerHaptic("light");
}

/** `[enabled, setEnabled]`, synced across tabs. Server render reports "on". */
export function useHapticsPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, hapticsEnabled, () => true);
  return [enabled, setHapticsEnabled];
}

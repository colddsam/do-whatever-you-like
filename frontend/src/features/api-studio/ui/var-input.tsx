"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useApi } from "../store";
import { DYNAMIC_NAMES, lookup, toMap, type Scopes } from "../lib/vars";
import type { VarInfo } from "./code-editor";
import { useFloating } from "./kit";

/** The variables a request can see (its collection's, the active environment's, globals and the vault). */
export function useVarInfo(collectionId?: string): VarInfo & { scopes: Scopes } {
  const ws = useApi((s) => s.ws);
  return useMemo(() => {
    const collection = ws.collections.find((c) => c.id === collectionId);
    const env = ws.environments.find((e) => e.id === ws.activeEnvId);
    const scopes: Scopes = { local: {}, data: {}, environment: toMap(env?.values), collection: toMap(collection?.variables), globals: toMap(ws.globals), vault: toMap(ws.vault) };
    const label: Record<string, string> = { environment: env ? `Environment · ${env.name}` : "Environment", collection: "Collection", globals: "Global", vault: "Vault", local: "Local", data: "Data" };
    const secret = new Set([...(env?.values ?? []), ...(collection?.variables ?? []), ...ws.globals, ...ws.vault.map((v) => ({ ...v, key: `vault:${v.key}` }))].filter((v) => v.type === "secret").map((v) => v.key));
    const names = () => {
      const out: { name: string; scope: string; value: string }[] = [];
      const seen = new Set<string>();
      for (const sc of ["environment", "collection", "globals"] as const)
        for (const [k, v] of Object.entries(scopes[sc]))
          if (!seen.has(k)) {
            seen.add(k);
            out.push({ name: k, scope: label[sc], value: secret.has(k) ? "••••••" : v });
          }
      for (const k of Object.keys(scopes.vault)) out.push({ name: `vault:${k}`, scope: "Vault", value: "••••••" });
      return out;
    };
    return {
      scopes,
      known: (n: string) => !!lookup(n, scopes) || n.startsWith("$"),
      describe: (n: string) => {
        const hit = lookup(n, scopes);
        return hit ? { value: secret.has(n) || hit.scope === "vault" ? "•••••• (secret)" : hit.value, scope: label[hit.scope] } : null;
      },
      names,
    };
  }, [ws, collectionId]);
}

export const VarsContext = createContext<VarInfo | null>(null);

function Highlighted({ text, vars }: { text: string; vars: VarInfo | null }) {
  const parts = text.split(/(\{\{[^{}]+?\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{([^{}]+?)\}\}$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const ok = m[1].trim().startsWith("$") || vars?.known(m[1].trim());
        return (
          <span key={i} className={cn("rounded-[3px]", ok ? "bg-success/12 text-success" : "bg-danger/12 text-danger")}>
            {p}
          </span>
        );
      })}
      {/* A trailing space keeps the mirror's width in step with the caret at the end. */}
      <span> </span>
    </>
  );
}

export function VarInput({
  value,
  onChange,
  placeholder,
  className,
  mono = true,
  onEnter,
  ariaLabel,
  type,
  disabled,
  onPasteText,
  list,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  onEnter?: () => void;
  ariaLabel: string;
  type?: "password";
  disabled?: boolean;
  /** Return true to take over a paste (e.g. a cURL command pasted in the URL bar). */
  onPasteText?: (text: string) => boolean;
  /** A <datalist> id with suggestions (header names). */
  list?: string;
  /** Focus on mount with the caret at the end (a row just created by typing into the empty row). */
  autoFocus?: boolean;
}) {
  const vars = useContext(VarsContext);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    if (!autoFocus || !input.current) return;
    const el = input.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Only when the field first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ac, setAc] = useState<{ query: string; start: number; index: number } | null>(null);
  const pos = useFloating(!!ac, wrap);

  const options = useMemo(() => {
    if (!ac) return [];
    const q = ac.query.toLowerCase();
    const all = [...(vars?.names() ?? []), ...DYNAMIC_NAMES.map((n) => ({ name: `$${n}`, scope: "Dynamic", value: "" }))];
    return all.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 60);
  }, [ac, vars]);

  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = /\{\{([^{}\s]*)$/.exec(before);
    setAc(m ? { query: m[1], start: caret - m[1].length, index: 0 } : null);
  };

  const pick = (name: string) => {
    if (!ac || !input.current) return;
    const caret = input.current.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[^{}\s]*\}\}/, "");
    const next = `${value.slice(0, ac.start)}${name}}}${after}`;
    onChange(next);
    setAc(null);
    const at = ac.start + name.length + 2;
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(at, at);
      input.current?.focus();
    });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (ac && options.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index + 1) % options.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index - 1 + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[ac.index].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };

  const title = useMemo(() => {
    const names = [...value.matchAll(/\{\{([^{}]+?)\}\}/g)].map((m) => m[1].trim());
    if (!names.length || !vars) return undefined;
    return names.map((n) => (n.startsWith("$") ? `${n}: random each send` : `${n} = ${vars.describe(n)?.value ?? "(not defined)"}`)).join("\n");
  }, [value, vars]);

  const masked = type === "password";
  return (
    <div ref={wrap} className={cn("relative min-w-0 rounded-md border border-line bg-surface focus-within:border-ink focus-within:ring-2 focus-within:ring-accent/20", disabled && "opacity-50", className)} title={title}>
      {!masked && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className={cn("whitespace-pre px-2.5 text-[13px] leading-[30px] text-ink", mono && "font-mono")} style={{ transform: `translateX(${-scroll}px)` }}>
            {value ? <Highlighted text={value} vars={vars} /> : null}
          </div>
        </div>
      )}
      <input
        ref={input}
        list={list}
        type={masked ? "password" : "text"}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onPaste={(e) => {
          if (!onPasteText) return;
          const t = e.clipboardData.getData("text");
          if (onPasteText(t)) e.preventDefault();
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        onScroll={(e) => setScroll((e.target as HTMLInputElement).scrollLeft)}
        onSelect={(e) => setScroll((e.target as HTMLInputElement).scrollLeft)}
        className={cn(
          "relative block h-[30px] w-full min-w-0 bg-transparent px-2.5 text-[13px] leading-[30px] outline-none placeholder:text-ink-3",
          mono && "font-mono",
          masked ? "text-ink" : "text-transparent caret-ink selection:bg-accent/25 selection:text-transparent",
        )}
      />
      {ac &&
        options.length > 0 &&
        pos &&
        createPortal(
          <div
            role="listbox"
            aria-label="Variables"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: Math.min(280, pos.maxH), minWidth: Math.min(360, Math.max(240, pos.minW)) }}
            className="fixed z-[150] w-max max-w-[min(420px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-float"
            data-lenis-prevent
          >
            {options.map((o, i) => (
              <button
                key={o.name}
                type="button"
                role="option"
                aria-selected={i === ac.index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.name);
                }}
                className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1 text-left", i === ac.index ? "bg-ink text-paper" : "hover:bg-paper-2")}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{o.name}</span>
                <span className={cn("shrink-0 font-mono text-[12px]", i === ac.index ? "text-paper/70" : "text-ink-3")}>{o.scope}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

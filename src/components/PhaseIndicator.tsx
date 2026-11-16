"use client";

import { useEffect, useState } from "react";
import type { BeatClock } from "@/lib/beatClock";
import { getTiming } from "@/lib/cardiac";
import type { Messages } from "@/lib/i18n";

type Stage = "systole" | "diastole";

/** Lights up the current phase. Re-renders twice per beat, not per frame. */
export function PhaseIndicator({
  clock,
  t,
}: {
  clock: BeatClock;
  t: Messages;
}) {
  const [stage, setStage] = useState<Stage>("diastole");

  useEffect(() => {
    return clock.subscribe((frame) => {
      const timing = getTiming(frame.shapeBpm);
      const tMs = frame.phase * timing.periodMs;
      const next: Stage =
        tMs >= timing.s1Ms && tMs < timing.s2Ms ? "systole" : "diastole";
      setStage((current) => (current === next ? current : next));
    });
  }, [clock]);

  const items: { id: Stage; label: string; hint: string }[] = [
    { id: "systole", label: t.systole, hint: t.systoleHint },
    { id: "diastole", label: t.diastole, hint: t.diastoleHint },
  ];

  return (
    <div aria-hidden="true" className="flex gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
      {items.map((item) => {
        const active = stage === item.id;
        return (
          <div
            key={item.id}
            className={`flex items-center gap-2 border px-3 py-1.5 transition-colors duration-100 ${
              active
                ? "border-crimson/70 bg-crimson/10 text-bone"
                : "border-line text-muted/60"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 ${active ? "bg-ember shadow-[0_0_10px_2px_rgba(255,80,90,0.8)]" : "bg-line"}`}
            />
            <span>{item.label}</span>
            <span className="hidden normal-case tracking-normal text-muted/70 sm:inline">
              {item.hint}
            </span>
          </div>
        );
      })}
    </div>
  );
}

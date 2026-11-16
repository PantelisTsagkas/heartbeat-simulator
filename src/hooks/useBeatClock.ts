"use client";

import { useEffect, useState } from "react";
import { createBeatClock, type BeatClock } from "@/lib/beatClock";

/**
 * Owns the single requestAnimationFrame loop. The returned clock object is
 * stable, so components that subscribe to it never re-render per frame.
 */
export function useBeatClock(bpm: number, playing: boolean): BeatClock {
  const [clock] = useState(() => createBeatClock(bpm));

  useEffect(() => {
    clock.setBpm(bpm);
  }, [clock, bpm]);

  useEffect(() => {
    clock.setPlaying(playing);
    return () => clock.dispose();
  }, [clock, playing]);

  return clock;
}

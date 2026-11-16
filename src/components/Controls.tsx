"use client";

import type { CSSProperties } from "react";
import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { BPM_MAX, BPM_MIN, PRESETS } from "@/lib/cardiac";
import type { HeartSound } from "@/hooks/useHeartSound";
import type { Messages } from "@/lib/i18n";

interface ControlsProps {
  bpm: number;
  playing: boolean;
  sound: HeartSound;
  t: Messages;
  onBpmChange: (bpm: number) => void;
  onTogglePlaying: () => void;
}

const fill = (value: number, min: number, max: number) =>
  ({ "--fill": `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

const buttonBase =
  "flex items-center justify-center gap-2 border font-mono text-xs uppercase tracking-[0.14em] transition-colors duration-150 cursor-pointer";

export function Controls({
  bpm,
  playing,
  sound,
  t,
  onBpmChange,
  onTogglePlaying,
}: ControlsProps) {
  const volumePercent = Math.round(sound.volume * 100);
  const VolumeIcon = !sound.enabled
    ? VolumeX
    : volumePercent < 50
      ? Volume1
      : Volume2;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="bpm-slider" className="eyebrow">
            {t.heartRate}
          </label>
          <span className="font-mono text-xs text-muted">
            {t.range(BPM_MIN, BPM_MAX)}
          </span>
        </div>
        <input
          id="bpm-slider"
          type="range"
          className="range"
          min={BPM_MIN}
          max={BPM_MAX}
          step={1}
          value={bpm}
          style={fill(bpm, BPM_MIN, BPM_MAX)}
          aria-valuetext={t.bpmValueText(bpm)}
          onChange={(event) => onBpmChange(Number(event.target.value))}
        />
      </div>

      <div role="group" aria-label={t.presets}>
        <div className="eyebrow mb-2">{t.presets}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-5">
          {PRESETS.map((preset) => {
            const active = preset.bpm === bpm;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => onBpmChange(preset.bpm)}
                className={`${buttonBase} flex-col !gap-0.5 px-2 py-2.5 last:col-span-2 sm:last:col-span-1 lg:last:col-span-2 xl:last:col-span-1 ${
                  active
                    ? "border-crimson bg-crimson/15 text-bone"
                    : "border-line text-muted hover:border-crimson/60 hover:text-bone"
                }`}
              >
                <span className="text-base tracking-normal text-bone">
                  {preset.bpm}
                </span>
                <span className="text-[10px] normal-case tracking-normal">
                  {t.presetLabels[preset.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onTogglePlaying}
          aria-label={playing ? t.pauseAria : t.resumeAria}
          data-testid="play-toggle"
          className={`${buttonBase} px-3 py-3 ${
            playing
              ? "border-line text-bone hover:border-crimson/60"
              : "border-crimson bg-crimson/15 text-bone"
          }`}
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          {playing ? t.pause : t.play}
        </button>
        <button
          type="button"
          onClick={sound.toggle}
          aria-pressed={sound.enabled}
          aria-label={t.soundAria}
          data-testid="sound-toggle"
          disabled={sound.unavailable}
          className={`${buttonBase} px-3 py-3 disabled:cursor-not-allowed disabled:opacity-40 ${
            sound.enabled
              ? "border-crimson bg-crimson/15 text-bone"
              : "border-line text-bone hover:border-crimson/60"
          }`}
        >
          <VolumeIcon size={16} aria-hidden />
          {sound.enabled ? t.soundOn : t.soundOff}
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="volume-slider" className="eyebrow">
            {t.volume}
          </label>
          <span className="font-mono text-xs text-muted">{volumePercent}%</span>
        </div>
        <input
          id="volume-slider"
          type="range"
          className="range"
          min={0}
          max={100}
          step={1}
          value={volumePercent}
          style={fill(volumePercent, 0, 100)}
          aria-valuetext={t.percent(volumePercent)}
          onChange={(event) => sound.setVolume(Number(event.target.value) / 100)}
        />
        <p className="mt-2 text-xs text-muted" role="status">
          {sound.unavailable
            ? t.soundUnavailable
            : sound.enabled
              ? t.soundOnNote
              : t.soundOffNote}
        </p>
      </div>
    </div>
  );
}

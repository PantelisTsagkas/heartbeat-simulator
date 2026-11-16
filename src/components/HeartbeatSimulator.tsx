"use client";

import { useCallback, useState } from "react";
import { HeartPulse, Info } from "lucide-react";
import { Controls } from "@/components/Controls";
import { EcgCanvas } from "@/components/EcgCanvas";
import { HeartVisual } from "@/components/HeartVisual";
import { InfoSection } from "@/components/InfoSection";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { useBeatClock } from "@/hooks/useBeatClock";
import { useHeartSound } from "@/hooks/useHeartSound";
import { useLocale } from "@/hooks/useLocale";
import { LOCALES } from "@/lib/i18n";
import {
  BPM_DEFAULT,
  BPM_MAX,
  BPM_MIN,
  getTiming,
  rateZone,
} from "@/lib/cardiac";

export function HeartbeatSimulator() {
  // The one source of truth. Everything else is derived from it.
  const [bpm, setBpm] = useState(BPM_DEFAULT);
  const [playing, setPlaying] = useState(true);

  const { locale, t, setLocale } = useLocale();
  const clock = useBeatClock(bpm, playing);
  const sound = useHeartSound(clock);

  const handleBpmChange = useCallback((next: number) => {
    setBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(next))));
  }, []);
  const togglePlaying = useCallback(() => setPlaying((value) => !value), []);

  const description = t.zones[rateZone(bpm)];
  const timing = getTiming(bpm);
  const stats = [
    { label: t.oneBeat, value: `${Math.round(timing.periodMs)} ms` },
    { label: t.systole, value: `~${Math.round(timing.systoleMs)} ms` },
    { label: t.diastole, value: `~${Math.round(timing.diastoleMs)} ms` },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-mono text-xl font-semibold tracking-tight text-bone sm:text-2xl">
            <HeartPulse className="text-ember" size={24} aria-hidden />
            {t.appName}
          </h1>
          <p className="mt-1 text-sm text-muted sm:text-base">
            {t.subtitle}
          </p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <div
            role="group"
            aria-label={t.language}
            className="flex self-start font-mono text-xs md:self-end"
          >
            {LOCALES.map((item) => {
              const active = item.id === locale;
              return (
                <button
                  key={item.id}
                  type="button"
                  lang={item.id}
                  aria-pressed={active}
                  aria-label={item.name}
                  onClick={() => setLocale(item.id)}
                  className={`-ml-px cursor-pointer border px-3 py-1.5 tracking-[0.14em] transition-colors first:ml-0 ${
                    active
                      ? "relative z-10 border-crimson bg-crimson/15 text-bone"
                      : "border-line text-muted hover:text-bone"
                  }`}
                >
                  {item.short}
                </button>
              );
            })}
          </div>
          <p className="flex max-w-md items-start gap-2 text-xs leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-ember" aria-hidden />
            <span>{t.disclaimer}</span>
          </p>
        </div>
      </header>

      <main className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section
          aria-label={t.heartSection}
          className="panel relative flex flex-col overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
            <span className="eyebrow">{t.liveModel}</span>
            <PhaseIndicator clock={clock} t={t} />
          </div>
          <div className="flex flex-1 items-center px-6 py-2 sm:px-10">
            <HeartVisual clock={clock} label={t.heartAlt} />
          </div>
          <div className="border-t border-line">
            <div className="flex items-baseline justify-between px-4 pt-3 sm:px-5">
              <span className="eyebrow">{t.rhythmTrace}</span>
              <span className="font-mono text-[11px] text-muted">
                {t.grid}
              </span>
            </div>
            <EcgCanvas clock={clock} label={t.ecgAlt(bpm)} />
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section aria-label={t.heartRate} className="panel p-5">
            <div className="eyebrow">{t.heartRate}</div>
            <div className="mt-1 flex items-end gap-3">
              <output
                htmlFor="bpm-slider"
                className="font-mono text-7xl font-semibold leading-none tabular-nums text-bone sm:text-8xl"
              >
                {bpm}
              </output>
              <span className="pb-2 font-mono text-sm uppercase tracking-[0.2em] text-ember">
                BPM
              </span>
            </div>
            <div aria-live="polite" className="mt-4 min-h-[5.5rem]">
              <h2 className="font-mono text-sm uppercase tracking-[0.12em] text-ember">
                {description.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-bone/80">
                {description.body}
              </p>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-px border border-line bg-line">
              {stats.map((stat) => (
                <div key={stat.label} className="bg-ink px-3 py-2.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    {stat.label}
                  </dt>
                  <dd className="mt-0.5 font-mono text-sm tabular-nums text-bone">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">
              {t.timingsNote}
            </p>
          </section>

          <section aria-label={t.controls} className="panel p-5">
            <Controls
              bpm={bpm}
              playing={playing}
              sound={sound}
              t={t}
              onBpmChange={handleBpmChange}
              onTogglePlaying={togglePlaying}
            />
          </section>
        </div>
      </main>

      <InfoSection t={t} />

      <footer className="mt-10 border-t border-line pt-4 font-mono text-[11px] text-muted">
        {t.footer}
      </footer>
    </div>
  );
}

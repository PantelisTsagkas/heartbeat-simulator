import { Activity, Footprints, Minimize2, Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n";

/** Same order as `topics` in the message catalogue. */
const ICONS: ReactNode[] = [
  <Activity key="bpm" size={16} aria-hidden />,
  <Minimize2 key="systole" size={16} aria-hidden />,
  <Maximize2 key="diastole" size={16} aria-hidden />,
  <Footprints key="activity" size={16} aria-hidden />,
];

export function InfoSection({ t }: { t: Messages }) {
  return (
    <section aria-labelledby="learn-heading" className="mt-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="learn-heading" className="eyebrow">
          {t.howItWorks}
        </h2>
        <span className="hidden font-mono text-xs text-muted sm:inline">
          {t.howItWorksHint}
        </span>
      </div>
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {t.topics.map((topic, index) => (
          <article key={topic.title} className="bg-ink p-5">
            <h3 className="mb-2 flex items-center gap-2 font-mono text-sm text-bone">
              <span className="text-ember">{ICONS[index]}</span>
              {topic.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted">{topic.body}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
        <strong className="font-medium text-bone">{t.variationLead}</strong>{" "}
        {t.variationBody}
      </p>
    </section>
  );
}

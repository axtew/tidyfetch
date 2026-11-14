import type { TimelineEntry } from "./timelineStore";

interface TimelineProps {
  entries: readonly TimelineEntry[];
  /** `performance.now()` at the start of the run: times are shown from it. */
  start: number;
}

export function Timeline({ entries, start }: TimelineProps) {
  return (
    <ol className="timeline" aria-label="Timeline">
      {entries.map((entry) => (
        <li key={entry.id} className={`tone-${entry.tone}`}>
          <span className="time">+{Math.max(0, Math.round(entry.time - start))} ms</span>
          <span className={`source source-${entry.source}`}>{entry.source}</span>
          <span className="label">{entry.label}</span>
          <span className="text">{entry.text}</span>
        </li>
      ))}
    </ol>
  );
}

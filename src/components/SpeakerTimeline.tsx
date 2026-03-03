import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { PARTY_COLORS } from "@/lib/mock-data";

export interface InterventionSummary {
  deputy_name: string;
  party: string | null;
  word_count: number | null;
  filler_word_count: number | null;
  was_mic_cutoff: boolean | null;
}

interface SpeakerTimelineProps {
  interventions: InterventionSummary[];
  maxSpeakers?: number;
}

export function SpeakerTimeline({ interventions, maxSpeakers = 15 }: SpeakerTimelineProps) {
  // Aggregate by deputy
  const aggMap: Record<string, { name: string; party: string; words: number; fillers: number }> = {};
  for (const iv of interventions) {
    const key = iv.deputy_name;
    if (!aggMap[key]) {
      aggMap[key] = { name: iv.deputy_name, party: iv.party ?? "?", words: 0, fillers: 0 };
    }
    aggMap[key].words   += iv.word_count   ?? 0;
    aggMap[key].fillers += iv.filler_word_count ?? 0;
  }

  const data = Object.values(aggMap)
    .sort((a, b) => b.words - a.words)
    .slice(0, maxSpeakers)
    .map(d => ({
      name:    d.name.split(" ").slice(-1)[0], // Last name only for readability
      party:   d.party,
      words:   d.words,
      fillers: d.fillers,
      // ~150 words/min
      minutes: Math.round(d.words / 150),
    }));

  if (!data.length) {
    return (
      <div className="text-center text-muted-foreground text-sm py-8">
        Sem dados de intervenções
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Tempo de antena (estimado)
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 60, bottom: 0, left: 70 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            width={65}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="glass-card rounded-lg p-2 text-xs space-y-0.5">
                  <p className="font-semibold">{d.name} ({d.party})</p>
                  <p>{d.words.toLocaleString()} palavras (~{d.minutes} min)</p>
                  <p className="text-primary">{d.fillers} enchimentos</p>
                </div>
              );
            }}
          />
          <Bar dataKey="words" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={PARTY_COLORS[entry.party] ?? "hsl(var(--primary))"}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

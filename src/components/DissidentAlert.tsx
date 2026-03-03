import { AlertTriangle } from "lucide-react";
import { PARTY_COLORS } from "@/lib/mock-data";

export interface DissidentInfo {
  name: string;
  party: string;
  vote: string;
  vote_description?: string;
}

interface DissidentAlertProps {
  dissidents: DissidentInfo[];
  voteDescription?: string;
}

export function DissidentAlert({ dissidents, voteDescription }: DissidentAlertProps) {
  if (!dissidents.length) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <h4 className="text-sm font-semibold text-amber-500">
          {dissidents.length === 1 ? "Deputado dissidente" : `${dissidents.length} deputados dissidentes`}
        </h4>
      </div>

      {voteDescription && (
        <p className="text-xs text-muted-foreground">{voteDescription}</p>
      )}

      <div className="space-y-1.5">
        {dissidents.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: (PARTY_COLORS[d.party] ?? "hsl(45 80% 55%)") + "20",
                color:       PARTY_COLORS[d.party] ?? "hsl(45 80% 55%)",
              }}
            >
              {d.party}
            </span>
            <span className="font-medium">{d.name}</span>
            <span className="text-muted-foreground">votou</span>
            <span
              className="font-semibold"
              style={{
                color: d.vote === "favor" || d.vote === "a_favor"
                  ? "hsl(145 60% 45%)"
                  : d.vote === "contra"
                  ? "hsl(0 70% 50%)"
                  : "hsl(220 20% 60%)",
              }}
            >
              {d.vote === "favor" || d.vote === "a_favor" ? "a favor"
               : d.vote === "contra" ? "contra"
               : d.vote ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { CheckCircle, XCircle, MinusCircle, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PARTY_COLORS } from "@/lib/mock-data";

export interface VoteData {
  id: string;
  description: string | null;
  result: string | null;
  favor: string[] | null;
  against: string[] | null;
  abstain: string[] | null;
  dissidents: Array<{ name: string; party: string; vote: string }> | null;
  initiative_reference: string | null;
}

interface VoteBreakdownProps {
  vote: VoteData;
}

function PartyPills({ parties, color }: { parties: string[]; color: string }) {
  if (!parties.length) return <span className="text-muted-foreground/50 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parties.map(p => (
        <span
          key={p}
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border"
          style={{
            borderColor: PARTY_COLORS[p] ?? color,
            color:       PARTY_COLORS[p] ?? color,
            background:  (PARTY_COLORS[p] ?? color) + "18",
          }}
        >
          {p}
        </span>
      ))}
    </div>
  );
}

export function VoteBreakdown({ vote }: VoteBreakdownProps) {
  const favor   = vote.favor   ?? [];
  const against = vote.against ?? [];
  const abstain = vote.abstain ?? [];
  const dissidents = vote.dissidents ?? [];

  const resultColor =
    vote.result === "aprovado"  ? "hsl(145 60% 45%)" :
    vote.result === "rejeitado" ? "hsl(0 70% 50%)"   :
                                  "hsl(220 20% 60%)";

  const ResultIcon =
    vote.result === "aprovado"  ? CheckCircle :
    vote.result === "rejeitado" ? XCircle     :
                                  MinusCircle;

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      {/* Result header */}
      <div className="flex items-start gap-3">
        <ResultIcon
          className="h-5 w-5 mt-0.5 flex-shrink-0"
          style={{ color: resultColor }}
        />
        <div className="flex-1 min-w-0">
          {vote.initiative_reference && (
            <span className="text-[10px] font-mono text-muted-foreground block mb-0.5">
              {vote.initiative_reference}
            </span>
          )}
          <p className="text-sm font-medium leading-snug">
            {vote.description ?? "Votação"}
          </p>
          <Badge
            variant="outline"
            className="mt-1 text-[10px] px-1.5 py-0 capitalize"
            style={{ borderColor: resultColor, color: resultColor }}
          >
            {vote.result ?? "?"}
          </Badge>
        </div>
      </div>

      {/* Party grid */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="space-y-1">
          <p className="font-semibold" style={{ color: "hsl(145 60% 45%)" }}>A favor</p>
          <PartyPills parties={favor} color="hsl(145 60% 45%)" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold" style={{ color: "hsl(0 70% 50%)" }}>Contra</p>
          <PartyPills parties={against} color="hsl(0 70% 50%)" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-muted-foreground">Abstenção</p>
          <PartyPills parties={abstain} color="hsl(220 20% 60%)" />
        </div>
      </div>

      {/* Dissidents */}
      {dissidents.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="flex items-center gap-1.5 text-xs text-amber-500 mb-1.5">
            <AlertTriangle className="h-3 w-3" />
            <span className="font-semibold">Dissidentes</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dissidents.map((d, i) => (
              <span key={i} className="text-[10px] bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                {d.name} ({d.party}) → {d.vote}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

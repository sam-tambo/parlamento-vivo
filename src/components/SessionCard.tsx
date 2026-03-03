import { motion } from "framer-motion";
import { Calendar, FileText, Vote, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

export interface SessionCardData {
  id: string;
  date: string;
  session_number: number | null;
  legislatura: string | null;
  dar_url: string | null;
  summary_pt: string | null;
  analysis_status: string | null;
  vote_count?: number;
  intervention_count?: number;
  deputies_present?: number | null;
}

interface SessionCardProps {
  session: SessionCardData;
  index?: number;
}

export function SessionCard({ session, index = 0 }: SessionCardProps) {
  const dateStr = new Date(session.date + "T12:00:00").toLocaleDateString("pt-PT", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });

  const statusColor =
    session.analysis_status === "analyzed"  ? "hsl(145 60% 45%)" :
    session.analysis_status === "extracted" ? "hsl(45 80% 55%)"  :
                                              "hsl(220 20% 60%)";

  const statusLabel =
    session.analysis_status === "analyzed"  ? "Analisado" :
    session.analysis_status === "extracted" ? "Extraído"  :
                                              "Pendente";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35 }}
      className="glass-card rounded-xl overflow-hidden hover:border-primary/30 transition-all duration-300 group"
    >
      <Link to={`/sessao/${session.id}`} className="block p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {session.session_number && (
                  <span className="text-xs font-mono text-muted-foreground">
                    DAR I {session.legislatura} nº{session.session_number}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                  style={{ borderColor: statusColor, color: statusColor }}
                >
                  {statusLabel}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                <Calendar className="h-3 w-3" />
                <span>{dateStr}</span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Summary preview */}
        {session.summary_pt ? (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-3">
            {session.summary_pt}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic mb-3">
            Resumo ainda não gerado
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {session.intervention_count != null && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {session.intervention_count} intervenções
            </span>
          )}
          {session.vote_count != null && (
            <span className="flex items-center gap-1">
              <Vote className="h-3 w-3" />
              {session.vote_count} votações
            </span>
          )}
          {session.deputies_present && (
            <span>{session.deputies_present} deputados</span>
          )}
          {session.dar_url && (
            <a
              href={session.dar_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="ml-auto text-primary hover:underline"
            >
              DAR PDF ↗
            </a>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

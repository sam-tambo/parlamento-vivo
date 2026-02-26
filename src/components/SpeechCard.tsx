import { motion } from "framer-motion";
import { Clock, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { PARTY_COLORS } from "@/lib/mock-data";

interface SpeechCardProps {
  politician: { name: string; party: string; photo_url: string | null };
  session_date: string;
  speaking_duration_seconds: number;
  filler_word_count: number;
  total_word_count: number;
  filler_ratio: number;
  transcript_excerpt?: string;
  filler_words_detail?: Record<string, number>;
  index?: number;
}

export function SpeechCard({
  politician, session_date, speaking_duration_seconds, filler_word_count,
  total_word_count, filler_ratio, transcript_excerpt, filler_words_detail, index = 0,
}: SpeechCardProps) {
  const initials = politician.name.split(" ").map(n => n[0]).join("").slice(0, 2);
  const mins = Math.floor(speaking_duration_seconds / 60);
  const secs = speaking_duration_seconds % 60;
  const dateStr = new Date(session_date).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
  const fillerPct = Math.round(filler_ratio * 100);

  // Highlight filler words in excerpt
  const highlightFillers = (text: string) => {
    if (!filler_words_detail) return text;
    const words = Object.keys(filler_words_detail).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})`, "gi");
    const parts = text.split(pattern);
    return parts.map((part, i) =>
      words.some(w => w.toLowerCase() === part.toLowerCase())
        ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="glass-card rounded-xl overflow-hidden group hover:border-primary/30 transition-all duration-300"
    >
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-10 w-10 border-2" style={{ borderColor: PARTY_COLORS[politician.party] }}>
            <AvatarFallback className="bg-secondary text-xs font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{politician.name}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span style={{ color: PARTY_COLORS[politician.party] }}>{politician.party}</span>
              <span>·</span>
              <span>{dateStr}</span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <p className="text-xs text-muted-foreground">Duração</p>
            <p className="text-sm font-mono font-semibold">{mins}:{secs.toString().padStart(2, "0")}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <p className="text-xs text-muted-foreground">Palavras</p>
            <p className="text-sm font-mono font-semibold">{total_word_count}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <p className="text-xs text-muted-foreground">Enchimento</p>
            <p className="text-sm font-mono font-semibold text-primary">{filler_word_count}</p>
          </div>
        </div>

        {/* Filler ratio bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Rácio de enchimento</span>
            <span className="font-mono font-semibold text-primary">{fillerPct}%</span>
          </div>
          <Progress value={Math.min(fillerPct * 5, 100)} className="h-1.5" />
        </div>

        {/* Transcript excerpt */}
        {transcript_excerpt && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 italic">
            "{highlightFillers(transcript_excerpt)}"
          </p>
        )}
      </div>
    </motion.div>
  );
}

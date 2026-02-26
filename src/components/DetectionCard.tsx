import { motion } from "framer-motion";
import { ExternalLink, Twitter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PARTY_COLORS } from "@/lib/mock-data";

interface DetectionCardProps {
  politician: { name: string; party: string; photo_url: string | null };
  detected_at: string;
  confidence: number;
  tweeted: boolean;
  tweet_url: string | null;
  index?: number;
}

export function DetectionCard({ politician, detected_at, confidence, tweeted, tweet_url, index = 0 }: DetectionCardProps) {
  const initials = politician.name.split(" ").map(n => n[0]).join("").slice(0, 2);
  const date = new Date(detected_at);
  const timeStr = date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="glass-card rounded-xl overflow-hidden group hover:border-primary/30 transition-all duration-300"
    >
      <div className="relative aspect-video bg-muted flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
        <span className="text-4xl opacity-20">📱</span>
        <div className="absolute top-3 right-3">
          <Badge variant="secondary" className="font-mono text-xs bg-background/60 backdrop-blur">
            {Math.round(confidence * 100)}%
          </Badge>
        </div>
        {tweeted && tweet_url && (
          <a
            href={tweet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-3 left-3 p-1.5 rounded-lg bg-background/60 backdrop-blur hover:bg-primary/20 transition-colors"
          >
            <Twitter className="h-3.5 w-3.5 text-primary" />
          </a>
        )}
      </div>
      <div className="p-4 flex items-center gap-3">
        <Avatar className="h-10 w-10 border-2" style={{ borderColor: PARTY_COLORS[politician.party] }}>
          <AvatarFallback className="bg-secondary text-xs font-bold">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{politician.name}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span style={{ color: PARTY_COLORS[politician.party] }}>{politician.party}</span>
            <span>·</span>
            <span>{dateStr} {timeStr}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

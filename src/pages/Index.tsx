import { motion } from "framer-motion";
import { Mic, Ear, Brain, BarChart3, ArrowRight, Zap, Radio, GitCompare, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SpeechCard } from "@/components/SpeechCard";
import { usePoliticians, useSpeeches } from "@/lib/queries";
import { gradeFillerRate } from "@/lib/filler-words";

const steps = [
  { icon: Ear,      title: "1. Monitorização",     desc: "O worker captura o stream ARTV Plenário em tempo real via HLS." },
  { icon: Brain,    title: "2. Transcrição IA",     desc: "Whisper transcreve áudio e pyannote.audio identifica cada orador." },
  { icon: Mic,      title: "3. Análise de discurso", desc: "30+ palavras de enchimento detectadas automaticamente em português." },
  { icon: BarChart3,title: "4. Rankings ao vivo",   desc: "Deputados classificados por rácio de enchimento, tempo e participação." },
];

const features = [
  { icon: Radio,      href: "/ao-vivo",     label: "Ao Vivo",     desc: "Transcrição em tempo real com enchimentos destacados" },
  { icon: Mic,        href: "/discursos",   label: "Discursos",   desc: "Arquivo de intervenções com análise completa" },
  { icon: BookOpen,   href: "/palavras",    label: "Palavras",    desc: "Catálogo de enchimentos e ranking por deputado" },
  { icon: GitCompare, href: "/comparar",    label: "Comparar",    desc: "Radar chart lado-a-lado de dois deputados" },
  { icon: BarChart3,  href: "/estatisticas",label: "Estatísticas",desc: "Tendências, partidos e análise temporal" },
];

export default function Index() {
  const { data: politicians = [] } = usePoliticians();
  const { data: speeches = [] } = useSpeeches();

  const active = politicians.filter(p => p.total_speeches > 0);
  const totalFillers = politicians.reduce((s, p) => s + p.total_filler_count, 0);
  const totalSpeeches = politicians.reduce((s, p) => s + p.total_speeches, 0);
  const avgRatio = active.length > 0
    ? active.reduce((s, p) => s + p.average_filler_ratio, 0) / active.length
    : 0;
  const grade = gradeFillerRate(avgRatio);

  const latestSpeeches = speeches.slice(0, 4);

  return (
    <div className="min-h-screen">
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mx-auto text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 mb-8">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">Análise de discurso parlamentar ao vivo</span>
            </div>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Quão vazio é o{" "}
              <span className="text-gradient-gold">discurso</span>
              <br />
              parlamentar?
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10">
              Analisamos as sessões plenárias da ARTV em tempo real — detetamos enchimentos,
              medimos participação e comparamos cada deputado.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/ao-vivo">
                <Button size="lg" className="gap-2 font-semibold">
                  <Radio className="h-4 w-4 animate-pulse" /> Ver ao Vivo
                </Button>
              </Link>
              <Link to="/estatisticas">
                <Button variant="outline" size="lg" className="gap-2">
                  <BarChart3 className="h-4 w-4" /> Estatísticas
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Counters */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto"
          >
            {[
              { label: "discursos",  value: totalSpeeches },
              { label: "enchimentos",value: totalFillers },
              { label: "rácio médio",value: `${(avgRatio * 100).toFixed(1)}%` },
              { label: "qualidade",  value: grade.label, style: { color: grade.color } },
            ].map(({ label, value, style }) => (
              <div key={label} className="glass-card glow-gold rounded-2xl px-4 py-5 text-center">
                <p className="text-3xl sm:text-4xl font-bold font-mono" style={style ?? undefined}>
                  {typeof value === "number" ? value : <span className="text-gradient-gold">{value}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Feature cards ─────────────────────────────────────── */}
      <section className="py-12 border-t border-border/40">
        <div className="container">
          <h2 className="text-xl font-semibold text-center text-muted-foreground mb-8">
            O que podes explorar
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {features.map((f, i) => (
              <motion.div
                key={f.href}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
              >
                <Link
                  to={f.href}
                  className="glass-card rounded-xl p-4 flex flex-col items-center text-center gap-2 hover:border-primary/30 hover:bg-primary/5 transition-all group block"
                >
                  <f.icon className="h-5 w-5 text-primary group-hover:scale-110 transition-transform" />
                  <p className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground leading-snug hidden sm:block">{f.desc}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Latest speeches ───────────────────────────────────── */}
      {latestSpeeches.length > 0 && (
        <section className="py-16 sm:py-20">
          <div className="container">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold">Últimos discursos</h2>
              <Link to="/discursos">
                <Button variant="ghost" className="gap-2 text-primary">
                  Ver todos <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {latestSpeeches.map((s, i) => (
                <SpeechCard
                  key={s.id}
                  politician={s.politician}
                  session_date={s.session_date ?? ""}
                  speaking_duration_seconds={s.speaking_duration_seconds}
                  filler_word_count={s.filler_word_count}
                  total_word_count={s.total_word_count}
                  filler_ratio={s.filler_ratio}
                  transcript_excerpt={s.transcript_excerpt ?? undefined}
                  filler_words_detail={s.filler_words_detail ?? undefined}
                  index={i}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── How it works ──────────────────────────────────────── */}
      <section className="py-16 sm:py-24 border-t border-border/50">
        <div className="container">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">Como funciona</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-card rounded-xl p-6 text-center"
              >
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 mb-4">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>
            Parlamento Vivo · Fonte:{" "}
            <a
              href="https://canal.parlamento.pt/plenario"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              ARTV Plenário
            </a>{" "}
            · Dados processados por IA, não representam posições oficiais.
          </p>
        </div>
      </footer>
    </div>
  );
}

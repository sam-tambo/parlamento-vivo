import { motion } from "framer-motion";
import { Mic, Ear, Brain, BarChart3, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SpeechCard } from "@/components/SpeechCard";
import { mockSpeeches, mockPoliticians } from "@/lib/mock-data";

const steps = [
  { icon: Ear, title: "Monitorização", desc: "As sessões plenárias da ARTV são descarregadas e processadas." },
  { icon: Brain, title: "Transcrição por IA", desc: "Whisper transcreve o áudio e identifica os oradores." },
  { icon: Mic, title: "Análise de discurso", desc: "Detetamos palavras de enchimento e medimos a qualidade." },
  { icon: BarChart3, title: "Rankings", desc: "Deputados são classificados pelo rácio de enchimento." },
];

const Index = () => {
  const totalFillers = mockPoliticians.reduce((s, p) => s + p.total_filler_count, 0);
  const totalSpeeches = mockPoliticians.reduce((s, p) => s + p.total_speeches, 0);
  const avgRatio = mockPoliticians.filter(p => p.total_speeches > 0).reduce((s, p) => s + p.average_filler_ratio, 0) / mockPoliticians.filter(p => p.total_speeches > 0).length;
  const latestSpeeches = mockSpeeches.slice(0, 4);

  return (
    <div className="min-h-screen">
      {/* Hero */}
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
              <span className="text-xs font-medium text-primary">Análise de discurso parlamentar</span>
            </div>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Quão vazio é o{" "}
              <span className="text-gradient-gold">discurso</span>
              <br />
              parlamentar?
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10">
              Analisamos as sessões plenárias para medir palavras de enchimento, tempo de discurso e participação dos deputados.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/speeches">
                <Button size="lg" className="gap-2 font-semibold">
                  Ver discursos <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/stats">
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
            className="mt-16 grid grid-cols-3 gap-4 max-w-lg mx-auto"
          >
            <div className="glass-card glow-gold rounded-2xl px-4 py-5 text-center">
              <p className="text-3xl sm:text-4xl font-bold text-gradient-gold font-mono">{totalSpeeches}</p>
              <p className="text-xs text-muted-foreground mt-1">discursos</p>
            </div>
            <div className="glass-card glow-gold rounded-2xl px-4 py-5 text-center">
              <p className="text-3xl sm:text-4xl font-bold text-gradient-gold font-mono">{totalFillers}</p>
              <p className="text-xs text-muted-foreground mt-1">enchimentos</p>
            </div>
            <div className="glass-card glow-gold rounded-2xl px-4 py-5 text-center">
              <p className="text-3xl sm:text-4xl font-bold text-gradient-gold font-mono">{(avgRatio * 100).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">rácio médio</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Latest Speeches */}
      <section className="py-16 sm:py-24">
        <div className="container">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold">Últimos discursos</h2>
            <Link to="/speeches">
              <Button variant="ghost" className="gap-2 text-primary">
                Ver todos <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {latestSpeeches.map((s, i) => (
              <SpeechCard key={s.id} {...s} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
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

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Palavras do Parlamento · Fonte: <a href="https://canal.parlamento.pt/plenario" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ARTV Plenário</a></p>
        </div>
      </footer>
    </div>
  );
};

export default Index;

import { motion } from "framer-motion";
import { Smartphone, Eye, Bot, Twitter, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DetectionCard } from "@/components/DetectionCard";
import { mockDetections } from "@/lib/mock-data";

const steps = [
  { icon: Eye, title: "Monitorização", desc: "O stream da ARTV é analisado diariamente das 10h às 17h." },
  { icon: Bot, title: "Deteção por IA", desc: "Algoritmos de visão computacional detetam o uso de telemóveis." },
  { icon: Smartphone, title: "Identificação", desc: "Reconhecimento facial identifica o deputado." },
  { icon: Twitter, title: "Publicação", desc: "O clip é automaticamente publicado no X/Twitter." },
];

const Index = () => {
  const totalDetections = 103; // Will come from DB
  const latestDetections = mockDetections.slice(0, 4);

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
              <span className="text-xs font-medium text-primary">Inspirado por Dries Depoorter</span>
            </div>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Os{" "}
              <span className="text-gradient-gold">Scrollers</span>
              <br />
              do Parlamento
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10">
              A monitorizar o uso de telemóveis na Assembleia da República. Porque a transparência importa.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/detections">
                <Button size="lg" className="gap-2 font-semibold">
                  Ver deteções <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="https://x.com" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="lg" className="gap-2">
                  <Twitter className="h-4 w-4" /> Seguir no X
                </Button>
              </a>
            </div>
          </motion.div>

          {/* Counter */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-16 flex justify-center"
          >
            <div className="glass-card glow-gold rounded-2xl px-10 py-6 text-center">
              <p className="text-5xl sm:text-6xl font-bold text-gradient-gold font-mono">{totalDetections}</p>
              <p className="text-sm text-muted-foreground mt-1">deteções até agora</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Latest Catches */}
      <section className="py-16 sm:py-24">
        <div className="container">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold">Últimas apanhadelas</h2>
            <Link to="/detections">
              <Button variant="ghost" className="gap-2 text-primary">
                Ver todas <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {latestDetections.map((d, i) => (
              <DetectionCard key={d.id} {...d} index={i} />
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
          <p>Os Scrollers do Parlamento · Inspirado por <a href="https://driesdepoorter.be/theflemishscrollers/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">The Flemish Scrollers</a></p>
        </div>
      </footer>
    </div>
  );
};

export default Index;

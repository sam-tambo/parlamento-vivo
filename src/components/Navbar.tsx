import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Mic, BarChart3, Users, MessageSquare, Radio, GitCompare, BookOpen, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { path: "/ao-vivo",      label: "Ao Vivo",      icon: Radio,       live: true  },
  { path: "/discursos",    label: "Discursos",    icon: MessageSquare             },
  { path: "/palavras",     label: "Palavras",     icon: BookOpen                  },
  { path: "/participacao", label: "Participação", icon: Users                     },
  { path: "/comparar",     label: "Comparar",     icon: GitCompare                },
  { path: "/estatisticas", label: "Estatísticas", icon: BarChart3                 },
];

export function Navbar() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <Mic className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight">
            <span className="text-gradient-gold">Parlamento</span>
            <span className="text-muted-foreground font-normal ml-1 text-sm hidden sm:inline">Vivo</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0.5">
          {navItems.map(({ path, label, icon: Icon, live }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                pathname === path
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              {live && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              )}
            </Link>
          ))}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
          onClick={() => setMobileOpen(o => !o)}
          aria-label="Menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border/40 bg-background/95 backdrop-blur-xl overflow-hidden"
          >
            <div className="container py-3 grid grid-cols-2 gap-1">
              {navItems.map(({ path, label, icon: Icon, live }) => (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    pathname === path
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                  {live && <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse ml-auto" />}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

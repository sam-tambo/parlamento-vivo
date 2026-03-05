import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Users, Search, Menu, X, FileText, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { path: "/",             label: "Início",        icon: Home         },
  { path: "/sessoes",      label: "Sessões",       icon: FileText     },
  { path: "/deputados",    label: "Deputados",     icon: Users        },
  { path: "/pesquisa",     label: "Pesquisa",      icon: Search       },
  { path: "/estatisticas", label: "Estatísticas",  icon: BarChart3    },
];

export function Navbar() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-bold text-sm">PV</span>
          </div>
          <span className="text-base font-bold tracking-tight hidden sm:inline">
            Parlamento Vivo
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive(path)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
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
            <div className="container py-2 space-y-0.5">
              {navItems.map(({ path, label, icon: Icon }) => (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(path)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

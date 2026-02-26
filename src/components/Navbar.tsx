import { Link, useLocation } from "react-router-dom";
import { Mic, BarChart3, Users, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "Início", icon: Mic },
  { path: "/speeches", label: "Discursos", icon: MessageSquare },
  { path: "/politicians", label: "Deputados", icon: Users },
  { path: "/stats", label: "Estatísticas", icon: BarChart3 },
];

export function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <Mic className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight">
            <span className="text-gradient-gold">Palavras</span>
            <span className="text-muted-foreground font-normal ml-1 text-sm">PT</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === path
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

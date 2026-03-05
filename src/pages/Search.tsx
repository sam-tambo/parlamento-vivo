import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Search as SearchIcon, Filter, X } from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";
import { SessionCard } from "@/components/SessionCard";
import { PartyBadge } from "@/components/PartyBadge";
import { useSearchSessions, usePoliticians } from "@/lib/queries";
import { PARTIES } from "@/lib/mock-data";

const LEGISLATURAS = ["", "XVII", "XVI", "XV"] as const;

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery]   = useState(initialQuery);
  const [party, setParty]   = useState("");
  const [leg, setLeg]       = useState("");
  const [submitted, setSubmitted] = useState(initialQuery);

  // Also search deputies client-side
  const { data: politicians = [] } = usePoliticians();

  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== submitted) {
      setQuery(q);
      setSubmitted(q);
    }
  }, [searchParams]);

  const { data: results, isLoading } = useSearchSessions(submitted, party || undefined, leg || undefined);

  const handleSearch = useCallback(() => {
    if (query.trim().length >= 3) {
      setSubmitted(query);
      setSearchParams({ q: query });
    }
  }, [query, setSearchParams]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const clear = () => {
    setQuery("");
    setSubmitted("");
    setParty("");
    setLeg("");
    setSearchParams({});
  };

  // Filter deputies matching query
  const matchingDeputies = submitted.trim().length >= 2
    ? politicians.filter(p =>
        p.name.toLowerCase().includes(submitted.toLowerCase()) ||
        p.party.toLowerCase().includes(submitted.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-8 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2 text-primary">
            <SearchIcon className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wider">Pesquisa</span>
          </div>
          <h1 className="text-3xl font-bold">Pesquisar no Parlamento</h1>
          <p className="text-muted-foreground text-sm">
            Pesquisa por tema, palavras-chave, deputado ou partido
          </p>
        </motion.div>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ex: habitacao, orcamento, saude..."
                className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {query && (
                <button
                  onClick={clear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={query.trim().length < 3}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              Pesquisar
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Filter className="h-3 w-3" />
              <span>Filtros:</span>
            </div>

            <select
              value={party}
              onChange={e => setParty(e.target.value)}
              className="text-xs rounded-lg bg-secondary border border-border px-2.5 py-1.5 focus:outline-none"
            >
              <option value="">Todos os partidos</option>
              {PARTIES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={leg}
              onChange={e => setLeg(e.target.value)}
              className="text-xs rounded-lg bg-secondary border border-border px-2.5 py-1.5 focus:outline-none"
            >
              <option value="">Todas as legislaturas</option>
              {LEGISLATURAS.filter(Boolean).map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </motion.div>

        {/* Results */}
        {submitted && (
          <div className="space-y-6">
            {/* Deputies results */}
            {matchingDeputies.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Deputados ({matchingDeputies.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {matchingDeputies.map(p => (
                    <Link
                      key={p.id}
                      to={`/deputado/${p.id}`}
                      className="glass-card rounded-lg p-3 hover:border-primary/30 transition-all text-center"
                    >
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <PartyBadge party={p.party} />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Session results */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Sessoes
              </h3>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="glass-card rounded-xl h-28 animate-pulse" />
                  ))}
                </div>
              ) : results && results.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    {results.length} resultado{results.length !== 1 ? "s" : ""}
                  </p>
                  {results.map((s, i) => (
                    <SessionCard
                      key={s.id}
                      session={{
                        id:              s.id,
                        date:            s.date,
                        session_number:  s.session_number,
                        legislatura:     s.legislatura,
                        dar_url:         null,
                        summary_pt:      s.snippet ?? s.summary_pt,
                        analysis_status: null,
                      }}
                      index={i}
                    />
                  ))}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Sem resultados para "{submitted}"</p>
                  <p className="text-sm mt-1">Tente palavras-chave diferentes ou remova os filtros</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!submitted && (
          <div className="text-center py-16 text-muted-foreground/60">
            <SearchIcon className="h-12 w-12 mx-auto mb-3" />
            <p className="text-lg">Digite uma pesquisa para comecar</p>
            <p className="text-sm mt-1">Pesquise por tema, palavra-chave ou partido</p>
          </div>
        )}
      </div>
    </div>
  );
}

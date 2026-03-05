import { Info } from "lucide-react";

export function AIDisclaimer() {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground/70 bg-muted/30 rounded-lg px-3 py-2">
      <Info className="h-3 w-3 mt-0.5 shrink-0" />
      <span>Resumo gerado por IA. Consulte o DAR original para a versão oficial.</span>
    </div>
  );
}

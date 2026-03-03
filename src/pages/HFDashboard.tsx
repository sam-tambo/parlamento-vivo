import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { format, subDays, startOfDay, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Activity, DollarSign, HardDrive, Clock } from "lucide-react";

interface UsageRow {
  id: string;
  function_name: string;
  model_used: string | null;
  audio_bytes: number;
  duration_seconds: number | null;
  cost_estimated: number | null;
  created_at: string;
}

function useUsageLogs() {
  return useQuery({
    queryKey: ["hf-usage-log"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hf_usage_log")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
    refetchInterval: 30_000,
  });
}

function StatCard({ title, value, subtitle, icon: Icon }: { title: string; value: string; subtitle: string; icon: any }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export default function HFDashboard() {
  const { data: logs = [], isLoading, error } = useUsageLogs();

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = subDays(todayStart, 7);
  const monthStart = subDays(todayStart, 30);

  const todayLogs = logs.filter(l => new Date(l.created_at) >= todayStart);
  const weekLogs = logs.filter(l => new Date(l.created_at) >= weekStart);
  const monthLogs = logs.filter(l => new Date(l.created_at) >= monthStart);

  const sum = (arr: UsageRow[], key: "audio_bytes" | "cost_estimated" | "duration_seconds") =>
    arr.reduce((s, r) => s + (r[key] ?? 0), 0);

  const totalCost = sum(logs, "cost_estimated");
  const totalAudioMB = sum(logs, "audio_bytes") / (1024 * 1024);
  const totalDurationMin = sum(logs, "duration_seconds") / 60;

  // Daily aggregation for charts
  const dailyMap = new Map<string, { calls: number; cost: number; audioMB: number }>();
  for (const log of logs) {
    const day = format(parseISO(log.created_at), "yyyy-MM-dd");
    const entry = dailyMap.get(day) ?? { calls: 0, cost: 0, audioMB: 0 };
    entry.calls++;
    entry.cost += log.cost_estimated ?? 0;
    entry.audioMB += log.audio_bytes / (1024 * 1024);
    dailyMap.set(day, entry);
  }

  const dailyData = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date: format(parseISO(date), "dd MMM", { locale: pt }), ...v }));

  // Cumulative cost
  let cumCost = 0;
  const cumulativeData = dailyData.map(d => {
    cumCost += d.cost;
    return { date: d.date, cost: parseFloat(cumCost.toFixed(4)) };
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 pt-24">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">HuggingFace Usage</h1>
          <p className="text-muted-foreground mt-1">Monitorização de custos da API de transcrição Whisper</p>
        </div>

        {isLoading && <p className="text-muted-foreground">A carregar...</p>}
        {error && <p className="text-destructive">Erro: {String(error)}</p>}

        {/* Stats cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <StatCard
            title="Total Chamadas"
            value={logs.length.toLocaleString()}
            subtitle={`${todayLogs.length} hoje · ${weekLogs.length} esta semana`}
            icon={Activity}
          />
          <StatCard
            title="Custo Estimado"
            value={`$${totalCost.toFixed(4)}`}
            subtitle={`$${sum(monthLogs, "cost_estimated").toFixed(4)} últimos 30 dias`}
            icon={DollarSign}
          />
          <StatCard
            title="Áudio Processado"
            value={`${totalAudioMB.toFixed(1)} MB`}
            subtitle={`${(sum(monthLogs, "audio_bytes") / (1024 * 1024)).toFixed(1)} MB últimos 30 dias`}
            icon={HardDrive}
          />
          <StatCard
            title="Tempo de Inferência"
            value={`${totalDurationMin.toFixed(1)} min`}
            subtitle={`${(sum(monthLogs, "duration_seconds") / 60).toFixed(1)} min últimos 30 dias`}
            icon={Clock}
          />
        </div>

        {/* Charts */}
        <Tabs defaultValue="calls" className="space-y-4">
          <TabsList>
            <TabsTrigger value="calls">Chamadas</TabsTrigger>
            <TabsTrigger value="cost">Custo</TabsTrigger>
            <TabsTrigger value="audio">Áudio</TabsTrigger>
          </TabsList>

          <TabsContent value="calls">
            <Card>
              <CardHeader>
                <CardTitle>Chamadas por Dia</CardTitle>
                <CardDescription>Número de chamadas à API HuggingFace Whisper</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip />
                      <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cost">
            <Card>
              <CardHeader>
                <CardTitle>Custo Cumulativo ($)</CardTitle>
                <CardDescription>Estimativa baseada em ~$0.06/hora de áudio (HF Inference Pro)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
                      <Area type="monotone" dataKey="cost" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audio">
            <Card>
              <CardHeader>
                <CardTitle>Áudio Processado por Dia (MB)</CardTitle>
                <CardDescription>Volume de áudio enviado para transcrição</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)} MB`} />
                      <Line type="monotone" dataKey="audioMB" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Recent logs table */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Últimas Chamadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Data</th>
                    <th className="pb-2 pr-4">Modelo</th>
                    <th className="pb-2 pr-4">Áudio</th>
                    <th className="pb-2 pr-4">Duração</th>
                    <th className="pb-2">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(-20).reverse().map(log => (
                    <tr key={log.id} className="border-b border-border/50">
                      <td className="py-2 pr-4">{format(parseISO(log.created_at), "dd/MM HH:mm")}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{log.model_used ?? "—"}</td>
                      <td className="py-2 pr-4">{(log.audio_bytes / 1024).toFixed(0)} KB</td>
                      <td className="py-2 pr-4">{log.duration_seconds?.toFixed(1) ?? "—"}s</td>
                      <td className="py-2">${log.cost_estimated?.toFixed(6) ?? "—"}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Sem dados ainda</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

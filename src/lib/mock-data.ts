// Mock data for development before real data is connected

export const PARTIES = ["PS", "PSD", "CH", "IL", "BE", "PCP", "L", "PAN", "CDS-PP", "JPP"] as const;

export const PARTY_COLORS: Record<string, string> = {
  PS: "#E91E63",
  PSD: "#FF9800",
  CH: "#1a237e",
  IL: "#00BCD4",
  BE: "#b71c1c",
  PCP: "#F44336",
  L: "#4CAF50",
  PAN: "#8BC34A",
  "CDS-PP": "#2196F3",
  JPP: "#9C27B0",
};

export const FILLER_WORDS = [
  "portanto", "digamos", "ou seja", "pronto", "basicamente",
  "efetivamente", "de facto", "na verdade", "quer dizer", "tipo",
  "ok", "bem", "olhe", "enfim",
];

export const mockPoliticians = [
  { id: "1", name: "João Silva", party: "PS", photo_url: null, total_speaking_seconds: 4320, total_filler_count: 87, total_speeches: 14, average_filler_ratio: 0.042 },
  { id: "2", name: "Maria Santos", party: "PSD", photo_url: null, total_speaking_seconds: 3180, total_filler_count: 45, total_speeches: 11, average_filler_ratio: 0.028 },
  { id: "3", name: "André Costa", party: "CH", photo_url: null, total_speaking_seconds: 5400, total_filler_count: 156, total_speeches: 18, average_filler_ratio: 0.067 },
  { id: "4", name: "Ana Ferreira", party: "IL", photo_url: null, total_speaking_seconds: 2700, total_filler_count: 23, total_speeches: 9, average_filler_ratio: 0.018 },
  { id: "5", name: "Pedro Oliveira", party: "BE", photo_url: null, total_speaking_seconds: 1800, total_filler_count: 34, total_speeches: 6, average_filler_ratio: 0.038 },
  { id: "6", name: "Sofia Rodrigues", party: "PS", photo_url: null, total_speaking_seconds: 3900, total_filler_count: 98, total_speeches: 13, average_filler_ratio: 0.051 },
  { id: "7", name: "Rui Almeida", party: "PSD", photo_url: null, total_speaking_seconds: 2400, total_filler_count: 31, total_speeches: 8, average_filler_ratio: 0.026 },
  { id: "8", name: "Catarina Lopes", party: "PCP", photo_url: null, total_speaking_seconds: 900, total_filler_count: 8, total_speeches: 3, average_filler_ratio: 0.019 },
  { id: "9", name: "Miguel Pereira", party: "L", photo_url: null, total_speaking_seconds: 1500, total_filler_count: 52, total_speeches: 5, average_filler_ratio: 0.072 },
  { id: "10", name: "Inês Martins", party: "PAN", photo_url: null, total_speaking_seconds: 600, total_filler_count: 5, total_speeches: 2, average_filler_ratio: 0.017 },
  { id: "11", name: "Carlos Mendes", party: "PS", photo_url: null, total_speaking_seconds: 3600, total_filler_count: 110, total_speeches: 12, average_filler_ratio: 0.062 },
  { id: "12", name: "Teresa Gomes", party: "CH", photo_url: null, total_speaking_seconds: 0, total_filler_count: 0, total_speeches: 0, average_filler_ratio: 0 },
];

export const mockSpeeches = [
  {
    id: "s1", politician: mockPoliticians[2], session_date: "2026-02-26",
    speaking_duration_seconds: 312, filler_word_count: 14, total_word_count: 480, filler_ratio: 0.029,
    transcript_excerpt: "Senhor Presidente, portanto, nós temos aqui um problema que é, digamos, bastante complexo e que, basicamente, precisa de uma solução urgente...",
    filler_words_detail: { portanto: 5, digamos: 4, basicamente: 3, "ou seja": 2 },
  },
  {
    id: "s2", politician: mockPoliticians[0], session_date: "2026-02-26",
    speaking_duration_seconds: 245, filler_word_count: 8, total_word_count: 390, filler_ratio: 0.021,
    transcript_excerpt: "Portanto, quero deixar claro que esta proposta, na verdade, vai ao encontro daquilo que, enfim, todos nós queremos para o país...",
    filler_words_detail: { portanto: 3, "na verdade": 2, enfim: 2, pronto: 1 },
  },
  {
    id: "s3", politician: mockPoliticians[5], session_date: "2026-02-25",
    speaking_duration_seconds: 180, filler_word_count: 11, total_word_count: 270, filler_ratio: 0.041,
    transcript_excerpt: "Bem, eu acho que, tipo, precisamos de olhar para isto de outra forma, ou seja, não podemos continuar a, pronto, ignorar os dados...",
    filler_words_detail: { bem: 2, tipo: 3, "ou seja": 3, pronto: 3 },
  },
  {
    id: "s4", politician: mockPoliticians[3], session_date: "2026-02-25",
    speaking_duration_seconds: 420, filler_word_count: 4, total_word_count: 650, filler_ratio: 0.006,
    transcript_excerpt: "A nossa posição é clara: o mercado livre deve ser protegido e as regulamentações devem ser proporcionais aos objetivos que se pretendem alcançar...",
    filler_words_detail: { portanto: 2, "de facto": 2 },
  },
  {
    id: "s5", politician: mockPoliticians[8], session_date: "2026-02-24",
    speaking_duration_seconds: 156, filler_word_count: 18, total_word_count: 230, filler_ratio: 0.078,
    transcript_excerpt: "Portanto, digamos que, tipo, esta questão é, basicamente, uma questão de, enfim, de princípio, portanto, nós não podemos...",
    filler_words_detail: { portanto: 6, digamos: 4, tipo: 3, basicamente: 3, enfim: 2 },
  },
  {
    id: "s6", politician: mockPoliticians[10], session_date: "2026-02-24",
    speaking_duration_seconds: 290, filler_word_count: 22, total_word_count: 440, filler_ratio: 0.05,
    transcript_excerpt: "Olhe, eu quero dizer que, pronto, efetivamente temos de reconhecer que, portanto, há aqui uma situação que, digamos, merece reflexão...",
    filler_words_detail: { olhe: 3, pronto: 5, efetivamente: 4, portanto: 6, digamos: 4 },
  },
];

export const mockFillerRankByParty = PARTIES.map(party => {
  const partyPols = mockPoliticians.filter(p => p.party === party);
  const avgRatio = partyPols.length > 0
    ? partyPols.reduce((s, p) => s + p.average_filler_ratio, 0) / partyPols.length
    : 0;
  return { party, avgFillerRatio: Math.round(avgRatio * 1000) / 10 }; // percentage
});

export const mockSpeakingByParty = PARTIES.map(party => {
  const total = mockPoliticians.filter(p => p.party === party).reduce((s, p) => s + p.total_speaking_seconds, 0);
  return { party, totalMinutes: Math.round(total / 60) };
});

export const mockFillerTrend = [
  { date: "Seg", fillerRatio: 3.8 },
  { date: "Ter", fillerRatio: 4.2 },
  { date: "Qua", fillerRatio: 3.1 },
  { date: "Qui", fillerRatio: 5.1 },
  { date: "Sex", fillerRatio: 4.5 },
];

export const mockTopFillerWords = [
  { word: "portanto", count: 234 },
  { word: "ou seja", count: 187 },
  { word: "pronto", count: 156 },
  { word: "digamos", count: 134 },
  { word: "basicamente", count: 98 },
  { word: "enfim", count: 87 },
  { word: "efetivamente", count: 76 },
  { word: "tipo", count: 65 },
];

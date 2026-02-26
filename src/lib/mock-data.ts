// Mock data for development before real data is connected

export const PARTIES = ["PS", "PSD", "CH", "IL", "BE", "PCP", "L", "PAN"] as const;

export const PARTY_COLORS: Record<string, string> = {
  PS: "hsl(340 70% 50%)",
  PSD: "hsl(25 90% 55%)",
  CH: "hsl(220 70% 40%)",
  IL: "hsl(190 80% 50%)",
  BE: "hsl(350 80% 45%)",
  PCP: "hsl(0 70% 45%)",
  L: "hsl(145 60% 40%)",
  PAN: "hsl(160 50% 45%)",
};

export const mockPoliticians = [
  { id: "1", name: "João Silva", party: "PS", photo_url: null, times_caught: 12 },
  { id: "2", name: "Maria Santos", party: "PSD", photo_url: null, times_caught: 9 },
  { id: "3", name: "André Costa", party: "CH", photo_url: null, times_caught: 15 },
  { id: "4", name: "Ana Ferreira", party: "IL", photo_url: null, times_caught: 7 },
  { id: "5", name: "Pedro Oliveira", party: "BE", photo_url: null, times_caught: 5 },
  { id: "6", name: "Sofia Rodrigues", party: "PS", photo_url: null, times_caught: 11 },
  { id: "7", name: "Rui Almeida", party: "PSD", photo_url: null, times_caught: 8 },
  { id: "8", name: "Catarina Lopes", party: "PCP", photo_url: null, times_caught: 3 },
  { id: "9", name: "Miguel Pereira", party: "L", photo_url: null, times_caught: 6 },
  { id: "10", name: "Inês Martins", party: "PAN", photo_url: null, times_caught: 4 },
  { id: "11", name: "Carlos Mendes", party: "PS", photo_url: null, times_caught: 10 },
  { id: "12", name: "Teresa Gomes", party: "CH", photo_url: null, times_caught: 13 },
];

export const mockDetections = [
  { id: "d1", politician: mockPoliticians[2], detected_at: "2026-02-26T14:23:00Z", confidence: 0.94, tweeted: true, tweet_url: "https://x.com/scrollerspt/status/1" },
  { id: "d2", politician: mockPoliticians[0], detected_at: "2026-02-26T11:45:00Z", confidence: 0.87, tweeted: true, tweet_url: "https://x.com/scrollerspt/status/2" },
  { id: "d3", politician: mockPoliticians[5], detected_at: "2026-02-25T15:12:00Z", confidence: 0.91, tweeted: true, tweet_url: null },
  { id: "d4", politician: mockPoliticians[1], detected_at: "2026-02-25T10:33:00Z", confidence: 0.82, tweeted: false, tweet_url: null },
  { id: "d5", politician: mockPoliticians[3], detected_at: "2026-02-24T16:01:00Z", confidence: 0.96, tweeted: true, tweet_url: "https://x.com/scrollerspt/status/5" },
  { id: "d6", politician: mockPoliticians[11], detected_at: "2026-02-24T13:55:00Z", confidence: 0.89, tweeted: true, tweet_url: "https://x.com/scrollerspt/status/6" },
  { id: "d7", politician: mockPoliticians[6], detected_at: "2026-02-23T14:20:00Z", confidence: 0.78, tweeted: false, tweet_url: null },
  { id: "d8", politician: mockPoliticians[10], detected_at: "2026-02-23T11:10:00Z", confidence: 0.93, tweeted: true, tweet_url: "https://x.com/scrollerspt/status/8" },
];

export const mockStatsByParty = PARTIES.map(party => ({
  party,
  count: mockPoliticians.filter(p => p.party === party).reduce((sum, p) => sum + p.times_caught, 0),
}));

export const mockStatsOverTime = [
  { date: "Seg", detections: 8 },
  { date: "Ter", detections: 12 },
  { date: "Qua", detections: 6 },
  { date: "Qui", detections: 15 },
  { date: "Sex", detections: 10 },
];

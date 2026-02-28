import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import Index from "./pages/Index";
import AoVivo from "./pages/AoVivo";
import Speeches from "./pages/Speeches";
import Politicians from "./pages/Politicians";
import Stats from "./pages/Stats";
import FillerWords from "./pages/FillerWords";
import Comparar from "./pages/Comparar";
import Plenario from "./pages/Plenario";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/"             element={<Index />} />
          <Route path="/ao-vivo"      element={<AoVivo />} />
          <Route path="/discursos"    element={<Speeches />} />
          <Route path="/palavras"     element={<FillerWords />} />
          <Route path="/participacao" element={<Politicians />} />
          <Route path="/comparar"     element={<Comparar />} />
          <Route path="/estatisticas" element={<Stats />} />
          <Route path="/plenario"     element={<Plenario />} />
          {/* Legacy redirects */}
          <Route path="/speeches"     element={<Speeches />} />
          <Route path="/politicians"  element={<Politicians />} />
          <Route path="/stats"        element={<Stats />} />
          <Route path="*"             element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

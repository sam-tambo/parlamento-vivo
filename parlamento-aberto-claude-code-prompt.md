# PARLAMENTO ABERTO — Parliament Transparency & Accessibility Tool

## Claude Code Project Prompt

You are building **Parlamento Aberto**, a transparency and accessibility tool that makes the Portuguese Parliament's plenary sessions understandable to every citizen. This is NOT a tool to mock parliament — it is a tool to STRENGTHEN democracy by making parliamentary work accessible, searchable, and analyzable.

---

## MISSION

Transform 58-page parliamentary session transcripts (DARs) that nobody reads into 2-minute digestible intelligence that every Portuguese citizen can understand, search, and use to hold their representatives accountable.

---

## PHASE 1: DATA ACQUISITION — Scraping the DAR Archive

### Source

The official DAR (Diário da Assembleia da República) I Série archive lives at:
```
https://www.parlamento.pt/DAR/Paginas/DAR1Serie.aspx
```

This page contains links to PDF transcripts of every plenary session across all legislaturas (currently XVII Legislatura, 2025-2026).

### Scraping Strategy

**Step 1 — Understand the page structure**

Visit the DAR page and analyze:
- How legislaturas are organized (dropdown? tabs? pagination?)
- How individual DAR PDFs are linked (direct PDF links? intermediate pages?)
- URL patterns for each legislatura and session number
- Whether the site uses JavaScript rendering (may need Playwright/Puppeteer) or server-side HTML

```bash
# Start by fetching the page and analyzing its structure
curl -s "https://www.parlamento.pt/DAR/Paginas/DAR1Serie.aspx" | head -500
```

**Step 2 — Map the archive**

Build a complete index of all available DARs before downloading anything:
```
legislatura -> sessão legislativa -> número -> PDF URL -> date
```

Expected structure per DAR:
- Legislatura: XVII (current), XVI, XV, ... going back historically
- Sessão Legislativa: 1.ª, 2.ª, 3.ª, 4.ª per legislatura
- Número: Sequential (e.g., 56 = 56th session of that sessão legislativa)
- Date: The actual session date

**Step 3 — Download systematically**

```
data/
  raw/
    pdfs/
      XVII/
        1/
          DAR-I-056-2026-02-19.pdf
          DAR-I-055-2026-02-18.pdf
          ...
      XVI/
        ...
    index.json  ← master index of all DARs with metadata
```

Priority order:
1. Current legislatura (XVII) — most relevant, start here
2. Previous legislatura (XVI) — for historical comparison
3. Older legislaturas — background archive, lower priority

**Rate limiting**: Be respectful. Max 1 request per second. Include proper User-Agent header identifying the tool.

**Step 4 — Validate downloads**

After downloading, verify:
- PDF is valid (not a 404 error page saved as PDF)
- PDF is readable (not scanned image — most DARs are text-based PDFs)
- File size is reasonable (a typical DAR is 200KB-2MB)

---

## PHASE 2: PDF PROCESSING — Extracting Structured Data

### The DAR Structure

Each DAR I Série follows a consistent structure. Here is what to extract:

**Session Metadata:**
```json
{
  "legislatura": "XVII",
  "sessao_legislativa": "1.ª",
  "numero": 56,
  "date": "2026-02-18",
  "president": "José Pedro Correia de Aguiar-Branco",
  "secretaries": ["Francisco Figueira", "Joana Lima", "Maria Germana Rocha"],
  "start_time": "15:30",
  "end_time": "18:06",
  "deputies_present": 205
}
```

**Agenda Items (Ordem do Dia):**
```json
{
  "items": [
    {
      "number": 1,
      "type": "apreciação_parlamentar",
      "title": "Subsídio Social de Mobilidade — serviços aéreos regiões autónomas",
      "initiatives": [
        {
          "id": "6/XVII/1.ª",
          "type": "Apreciação Parlamentar",
          "party": "PS",
          "reference_law": "Decreto-Lei n.º 1-A/2026"
        }
      ]
    }
  ]
}
```

**Speaker Interventions — THE CORE DATA:**
```json
{
  "interventions": [
    {
      "id": "int_001",
      "speaker": "Francisco César",
      "party": "PS",
      "type": "intervenção",  // or "pedido_esclarecimento", "resposta", "aparte", "encerramento"
      "agenda_item": 1,
      "text": "Sr. Presidente, Sr.as e Srs. Deputados: Subsídio Social de Mobilidade...",
      "duration_estimate_seconds": null,  // calculated from text length if no audio
      "interrupted_by": ["Hugo Soares (PSD)"],
      "applause": ["PS"],
      "protests": ["PSD"],
      "word_count": 487,
      "key_claims": [],  // filled by AI analysis
      "sentiment": null   // filled by AI analysis
    }
  ]
}
```

**Votes:**
```json
{
  "votes": [
    {
      "initiative": "Proposta de Lei n.º 51/XVII/1.ª (ALRAA)",
      "result": "approved",
      "favor": ["CH", "PS", "IL", "L", "PCP", "BE", "PAN", "JPP"],
      "against": ["PSD", "CDS-PP"],
      "abstain": [],
      "dissidents": [
        {
          "deputies": ["Francisco Pimentel", "Nuna Menezes", "Paulo Moniz", "Paulo Neves", "Pedro Coelho", "Vânia Jesus"],
          "party": "PSD",
          "voted": "favor",
          "party_voted": "against"
        }
      ]
    }
  ]
}
```

**Declarations of Vote:**
```json
{
  "declarations": [
    {
      "party": "JPP",
      "deputy": "Filipe Sousa",
      "text": "...",
      "summary": null  // filled by AI
    }
  ]
}
```

### PDF Text Extraction

Use Python for extraction. The DARs are text-based PDFs (not scans):

```bash
pip install pdfplumber pymupdf
```

Key parsing challenges:
- Two-column layout on summary pages (pages 1-2)
- Single-column for transcript body (page 3+)
- Speaker identification: `O Sr. [Name] ([Party]): —` pattern
- Stage directions in italics: `Aplausos do PS.`, `Protestos do PSD.`, `Pausa.`
- Interruptions inline: `O Sr. Hugo Soares (PSD): — Qual proposta?`
- Automatic microphone cutoff: `Por ter excedido o tempo de intervenção, o microfone do orador foi automaticamente desligado.`

### Regex Patterns for Parsing

```python
# Speaker start pattern
SPEAKER_PATTERN = r'^(?:O Sr\.|A Sr\.ª)\s+(?:Presidente|Secretário|[\w\s]+)\s*(?:\(([^)]+)\))?\s*:\s*—'

# Stage direction patterns
APPLAUSE_PATTERN = r'Aplausos\s+(?:gerais|d[oa]s?\s+[\w\s,]+)\.'
PROTEST_PATTERN = r'Protestos?\s+(?:d[oa]s?\s+[\w\s,]+)\.'
PAUSE_PATTERN = r'^Pausa\.$'
NOISE_PATTERN = r'^Burburinho na Sala\.$'
MIC_CUTOFF = r'Por ter excedido o tempo de intervenção, o microfone d[oa] orador[a]? foi automaticamente desligado\.'

# Vote result pattern
VOTE_PATTERN = r'Submetida à votação, foi (aprovad[oa]|rejeitad[oa]),\s+com os votos'
```

---

## PHASE 3: AI ANALYSIS — Making Data Meaningful

### Per-Session Analysis (run via Claude API)

For each processed session, generate:

**1. Plain-Language Summary (max 300 words)**
What was discussed, what was decided, in language a non-political citizen understands.

**2. Key Decisions & Votes**
What passed, what failed, who voted how, and critically — who broke party lines.

**3. Speaker Analysis**
```json
{
  "speaker_stats": {
    "Francisco César (PS)": {
      "total_interventions": 5,
      "total_words": 2847,
      "estimated_speaking_time_minutes": 19,
      "interruptions_received": 12,
      "interruptions_made": 3,
      "applause_received": 8,
      "protests_received": 4,
      "communication_score": null  // future: from audio analysis
    }
  }
}
```

**4. Argument Mapping**
For each major topic, extract each party's core position:
```json
{
  "topic": "Subsídio Social de Mobilidade — exigência de situação fiscal regularizada",
  "positions": {
    "PS": "Against fiscal requirement. Mobility is a constitutional right, not conditional.",
    "PSD": "Defends fiscal requirement. Same principle as other state subsidies.",
    "CH": "Against fiscal requirement. Calls it discrimination against islanders.",
    "IL": "Against fiscal requirement. Rights vs obligations are separate constitutional planes.",
    "BE": "Against. Compares to mainland transport passes with no fiscal requirements.",
    "PCP": "Against. Proposes upfront subsidy at ticket purchase, not reimbursement.",
    "L": "Against. Calls it indirect fiscal coercion via essential transport.",
    "PAN": "Against. Wants deeper reform to ensure access reaches those most in need.",
    "CDS-PP": "Nuanced. Acknowledges constitutional question but defends government reform timeline.",
    "JPP": "Against. Proposes fixed-price model, rejects transitional regimes."
  }
}
```

**5. Confrontation Index**
Track which deputies/parties clashed most, with context.

**6. Notable Moments**
Flag unusual events: party splits, walk-outs, mic cutoffs, emotional exchanges, humor from the President.

### Cross-Session Analysis (aggregate)

Over time, build:
- Deputy attendance and speaking patterns
- Party voting consistency vs. stated positions
- Topic frequency and evolution
- Government presence/absence at debates
- Cross-party alliance patterns

---

## PHASE 4: DATA STORAGE — Supabase Schema

### Why Supabase
- Already in the Revenue Precision stack
- PostgreSQL with full-text search (critical for Portuguese language)
- Row-level security for future multi-user features
- Real-time subscriptions for live session updates
- Edge functions for API

### Database Schema

```sql
-- Core tables

CREATE TABLE legislaturas (
  id TEXT PRIMARY KEY,           -- 'XVII', 'XVI', etc.
  start_date DATE,
  end_date DATE,
  description TEXT
);

CREATE TABLE sessoes_legislativas (
  id TEXT PRIMARY KEY,           -- 'XVII-1', 'XVII-2', etc.
  legislatura_id TEXT REFERENCES legislaturas(id),
  number INTEGER,                -- 1, 2, 3, 4
  start_date DATE,
  end_date DATE
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_legislativa_id TEXT REFERENCES sessoes_legislativas(id),
  dar_number INTEGER NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  president TEXT,
  deputies_present INTEGER,
  
  -- PDF source
  pdf_url TEXT,
  pdf_hash TEXT,                  -- SHA256 for deduplication
  
  -- Processing status
  status TEXT DEFAULT 'pending',  -- pending, extracted, analyzed, published
  extracted_at TIMESTAMPTZ,
  analyzed_at TIMESTAMPTZ,
  
  -- AI-generated content
  summary_pt TEXT,                -- Portuguese plain-language summary
  summary_en TEXT,                -- English summary (for international transparency)
  key_decisions JSONB,
  notable_moments JSONB,
  
  -- Full extracted text for search
  full_text TEXT,
  
  UNIQUE(sessao_legislativa_id, dar_number)
);

-- Full-text search index (Portuguese)
CREATE INDEX sessions_search_idx ON sessions 
  USING gin(to_tsvector('portuguese', coalesce(full_text, '') || ' ' || coalesce(summary_pt, '')));

CREATE TABLE agenda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  item_number INTEGER,
  title TEXT,
  topic_category TEXT,            -- mobility, health, education, budget, etc.
  initiatives JSONB,              -- array of initiative references
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deputies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  party TEXT,                     -- current party
  circle TEXT,                    -- electoral circle
  legislatura_id TEXT REFERENCES legislaturas(id),
  
  -- Accumulated stats (updated by triggers/functions)
  total_interventions INTEGER DEFAULT 0,
  total_words INTEGER DEFAULT 0,
  total_sessions_present INTEGER DEFAULT 0,
  
  UNIQUE(name, party, legislatura_id)
);

CREATE TABLE interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  deputy_id UUID REFERENCES deputies(id),
  agenda_item_id UUID REFERENCES agenda_items(id),
  
  -- Intervention details
  type TEXT NOT NULL,              -- intervenção, pedido_esclarecimento, resposta, aparte, encerramento
  sequence_number INTEGER,        -- order within session
  text TEXT NOT NULL,
  word_count INTEGER,
  estimated_duration_seconds INTEGER,
  
  -- Reactions
  applause_from TEXT[],            -- party abbreviations
  protests_from TEXT[],
  interrupted_by TEXT[],
  was_mic_cutoff BOOLEAN DEFAULT false,
  
  -- AI analysis
  key_claims JSONB,
  sentiment_score FLOAT,           -- -1 to 1
  topic_tags TEXT[],
  
  -- Communication quality (future: from audio)
  filler_word_count INTEGER,
  filler_words_detail JSONB,       -- {"portanto": 12, "digamos": 3, ...}
  speech_clarity_score FLOAT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Full-text search on interventions
CREATE INDEX interventions_search_idx ON interventions 
  USING gin(to_tsvector('portuguese', text));

CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  agenda_item_id UUID REFERENCES agenda_items(id),
  
  initiative_reference TEXT,       -- "Proposta de Lei n.º 51/XVII/1.ª"
  initiative_origin TEXT,          -- "ALRAA", "CH", "PS", etc.
  description TEXT,
  
  result TEXT NOT NULL,            -- approved, rejected
  
  -- Vote breakdown
  favor TEXT[],                    -- party abbreviations
  against TEXT[],
  abstain TEXT[],
  
  -- This is GOLD for transparency
  dissidents JSONB,                -- deputies who broke party line
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vote_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id UUID REFERENCES votes(id) ON DELETE CASCADE,
  deputy_id UUID REFERENCES deputies(id),
  party TEXT,
  text TEXT,
  summary TEXT,                    -- AI-generated
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Party positions per topic (aggregated over time)
CREATE TABLE party_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  party TEXT NOT NULL,
  session_id UUID REFERENCES sessions(id),
  position_summary TEXT,           -- AI-generated
  vote_alignment TEXT,             -- favor, against, abstain, mixed
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cross-session analytics (materialized views)

CREATE MATERIALIZED VIEW deputy_activity AS
SELECT 
  d.id as deputy_id,
  d.name,
  d.party,
  d.circle,
  COUNT(DISTINCT i.session_id) as sessions_active,
  COUNT(i.id) as total_interventions,
  SUM(i.word_count) as total_words,
  AVG(i.sentiment_score) as avg_sentiment,
  SUM(CASE WHEN i.was_mic_cutoff THEN 1 ELSE 0 END) as mic_cutoffs,
  SUM(i.filler_word_count) as total_filler_words,
  array_agg(DISTINCT unnest(i.topic_tags)) as topics_discussed
FROM deputies d
LEFT JOIN interventions i ON i.deputy_id = d.id
GROUP BY d.id, d.name, d.party, d.circle;

CREATE MATERIALIZED VIEW party_voting_patterns AS
SELECT
  party,
  COUNT(*) as total_votes,
  SUM(CASE WHEN v.result = 'approved' THEN 1 ELSE 0 END) as votes_on_winning_side,
  COUNT(DISTINCT v.dissidents) FILTER (WHERE v.dissidents IS NOT NULL) as votes_with_dissidents
FROM votes v
CROSS JOIN LATERAL unnest(v.favor || v.against || v.abstain) as party
GROUP BY party;
```

### Supabase Edge Functions

```
functions/
  process-dar/        ← Takes a PDF URL, extracts and stores structured data
  analyze-session/    ← Runs Claude AI analysis on extracted session data
  search-sessions/    ← Full-text search across all sessions
  deputy-profile/     ← Aggregated deputy data
  session-summary/    ← Returns AI summary for a session
```

---

## PHASE 5: HOW THE SYSTEM SHOULD THINK

### Processing Pipeline

```
PDF Download → Text Extraction → Structural Parsing → AI Analysis → Storage → API → Frontend
```

Each step is idempotent. Re-running any step with the same input produces the same output. Track processing status per session.

### AI Analysis Prompt Template

When calling Claude API to analyze a session, use this system prompt:

```
You are a Portuguese parliamentary analyst. Your role is to make 
parliamentary proceedings accessible to citizens who don't follow 
politics closely.

You will receive the structured text of a plenary session from the 
Assembleia da República.

Your analysis must be:
- FACTUAL: Never editorialize or take sides. Report what happened.
- ACCESSIBLE: Write for a citizen with no political background.
- COMPLETE: Cover all major topics, votes, and notable events.
- RESPECTFUL: Parliament is a democratic institution. Analyze 
  without mocking.

For each session, produce:

1. RESUMO CIDADÃO (max 200 words)
   A plain-language summary a taxi driver or hairdresser would 
   understand. No jargon. No party acronyms without explanation.

2. DECISÕES
   What was voted on. What passed. What didn't. In simple terms.

3. QUEM DISSE O QUÊ
   Each party's core position on each topic, in 1-2 sentences.

4. DESTAQUES
   Notable moments: party splits, heated exchanges, unusual 
   alliances, government absence, emotional speeches.

5. DADOS
   - Most active speakers (by word count and interventions)
   - Parties most mentioned by others
   - Applause and protest distribution

Output as JSON matching the schema provided.
```

### Filler Word Detection (Future — Audio Layer)

When audio processing is available, detect these Portuguese parliamentary filler words:

```python
FILLER_WORDS_PT = {
    # Classic fillers
    "portanto": 0,    # "therefore" used as filler
    "pronto": 0,      # "ready/done" used as filler
    "digamos": 0,     # "let's say"
    "ou seja": 0,     # "that is" used as filler
    
    # Hesitation markers
    "uh": 0,
    "uhm": 0,
    "ah": 0,
    "ehm": 0,
    "hm": 0,
    
    # Parliamentary-specific fillers
    "efetivamente": 0,     # "effectively" (overused)
    "naturalmente": 0,     # "naturally" (overused)
    "evidentemente": 0,    # "evidently" (overused)
    "obviamente": 0,       # "obviously"
    "basicamente": 0,      # "basically"
    "sinceramente": 0,     # "sincerely" (used as filler)
    "francamente": 0,      # "frankly" (used as filler)
    "nomeadamente": 0,     # "namely" (overused in parliament)
    
    # Stalling phrases
    "como é óbvio": 0,
    "como sabem": 0,
    "devo dizer": 0,
    "quero dizer": 0,
    "tenho de dizer": 0,
    "é preciso dizer": 0
}
```

**Important context rule**: "portanto" used mid-sentence as a logical connector ("É, portanto, um direito.") is NOT a filler. "Portanto..." at the start of a sentence followed by a pause IS a filler. The AI must distinguish based on context and audio pauses.

---

## PHASE 6: FRONTEND — What Citizens See

### Core Pages

**1. Homepage — Latest Session**
- Today's (or most recent) session summary
- Key votes with results
- "Who said what" quick cards
- Search bar

**2. Session Detail Page**
- Full AI summary
- Interactive timeline of speakers
- Vote breakdown with visual party map
- Dissident deputy highlighting
- Link to original DAR PDF
- Link to video on canal.parlamento.pt

**3. Deputy Profile**
- Photo (from parlamento.pt)
- Party, circle, legislatura
- Speaking stats: total interventions, words, sessions
- Topics they speak about most
- Voting record vs. party line
- Communication metrics (when audio available)
- Timeline of all their interventions

**4. Search**
- Full-text search across all sessions
- Filter by: date range, party, deputy, topic, legislatura
- "What did [deputy] say about [topic]?"

**5. Party Comparison**
- Side-by-side position tracking on major topics
- Voting alignment matrix (who votes with whom)
- Evolution of positions over time

**6. Statistics Dashboard**
- Most active deputies
- Most debated topics
- Party discipline rates
- Government attendance
- Session duration trends

### Design Principles

- Portuguese first, English as secondary language option
- Mobile-first (most citizens will access on phones)
- Accessible (WCAG AA minimum)
- Fast (static generation where possible, real-time only for live sessions)
- Shareable (each insight should have its own URL and social card)
- Source-linked (every claim links back to the original DAR and timestamp)

---

## PHASE 7: IMPLEMENTATION ORDER

### Sprint 1: Foundation (Week 1)
- [ ] Scrape DAR index for XVII Legislatura
- [ ] Download all available PDFs for current legislatura
- [ ] Build PDF text extraction pipeline
- [ ] Build structural parser (speakers, votes, stage directions)
- [ ] Store raw extracted data in Supabase

### Sprint 2: Intelligence (Week 2)
- [ ] Build Claude API analysis pipeline
- [ ] Generate summaries for all downloaded sessions
- [ ] Extract and store voting records with dissidents
- [ ] Build deputy profiles from aggregated data
- [ ] Create party position mapping

### Sprint 3: Frontend MVP (Week 3)
- [ ] Session summary page
- [ ] Deputy profile page
- [ ] Basic search
- [ ] Homepage with latest session

### Sprint 4: Depth (Week 4)
- [ ] Cross-session analytics
- [ ] Party comparison tool
- [ ] Statistics dashboard
- [ ] Historical legislaturas (XVI, XV)

### Sprint 5: Live Layer (Week 5+)
- [ ] Audio processing pipeline (non-HF provider)
- [ ] Filler word detection
- [ ] Live session companion mode
- [ ] Real-time summary generation

---

## TECHNICAL CONSTRAINTS

- **Claude API**: Use for all AI analysis. Model: claude-sonnet-4-5-20250929
- **Supabase**: Primary database and API layer
- **No HuggingFace free tier**: Burned out. Use Deepgram or AssemblyAI for audio when needed
- **Respect parlamento.pt**: Rate limit all requests. Cache aggressively. Include proper attribution
- **GDPR compliance**: All data is public parliamentary record, but apply best practices
- **Attribution**: Always link back to original DAR source and parlamento.pt

---

## ETHICAL GUIDELINES

This tool exists to serve democracy, not to undermine it.

1. **Never mock individual deputies** — present data neutrally
2. **Never editorialize** — let citizens draw their own conclusions
3. **Always provide context** — a filler word count without speaking time context is misleading
4. **Always link sources** — every generated insight must trace back to the original DAR
5. **Present all parties fairly** — equal treatment regardless of political alignment
6. **Acknowledge limitations** — AI summaries are not official records; the DAR is
7. **Respect the institution** — parliament is messy by design; democratic debate is supposed to be passionate

---

## SUCCESS METRICS

- A citizen can understand any parliament session in under 2 minutes
- Any deputy's voting record is searchable in under 10 seconds
- Party positions on any topic are comparable side-by-side
- Dissident votes (party-line breaks) are automatically flagged
- The tool is cited by journalists as a reference source
- Deputies themselves find it useful for tracking proceedings

---

## FILE STRUCTURE

```
parlamento-aberto/
├── scraper/
│   ├── index_builder.py       # Builds master index of all DARs
│   ├── downloader.py          # Downloads PDFs with rate limiting
│   └── validator.py           # Validates downloaded PDFs
├── parser/
│   ├── extractor.py           # PDF to raw text
│   ├── structural_parser.py   # Text to structured JSON
│   ├── speaker_detector.py    # Identifies speakers and parties
│   ├── vote_parser.py         # Extracts vote results
│   └── stage_directions.py    # Parses applause, protests, etc.
├── analyzer/
│   ├── session_analyzer.py    # Claude API integration
│   ├── prompts/
│   │   ├── session_summary.txt
│   │   ├── argument_mapping.txt
│   │   └── deputy_analysis.txt
│   └── aggregator.py          # Cross-session analytics
├── api/
│   └── supabase/
│       ├── migrations/
│       │   └── 001_initial_schema.sql
│       └── functions/
│           ├── process-dar/
│           ├── analyze-session/
│           └── search/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.tsx       # Latest session
│   │   │   ├── session/[id].tsx
│   │   │   ├── deputy/[id].tsx
│   │   │   ├── search.tsx
│   │   │   └── stats.tsx
│   │   └── components/
│   │       ├── SessionCard.tsx
│   │       ├── VoteBreakdown.tsx
│   │       ├── SpeakerTimeline.tsx
│   │       ├── PartyPosition.tsx
│   │       └── DissidentAlert.tsx
│   └── public/
├── data/
│   ├── raw/pdfs/              # Downloaded DARs
│   ├── extracted/             # Parsed JSON per session
│   └── analyzed/              # AI analysis output
├── config/
│   ├── filler_words_pt.json
│   └── party_metadata.json
└── README.md
```

---

## START HERE

Begin with Phase 1. Your first task:

```
1. Visit https://www.parlamento.pt/DAR/Paginas/DAR1Serie.aspx
2. Analyze the page structure to understand how DARs are organized
3. Build the index of all available DAR I Série PDFs for the XVII Legislatura
4. Download the 5 most recent DARs as a test
5. Extract text from one DAR and parse it into the structured format above
6. Report back what you found and any issues with the parsing
```

Good luck. You're building something that matters.

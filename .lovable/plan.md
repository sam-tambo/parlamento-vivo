

# Portuguese Parliament Scrollers 🇵🇹📱

A web platform that catches Portuguese parliament members using their phones during sessions, inspired by Dries Depoorter's "The Flemish Scrollers." The system monitors the ARTV livestream daily from 10:00 to 17:00, detects phone usage via AI, identifies the politician, and automatically posts the clip to X/Twitter.

## Architecture Overview

The project has two parts:
1. **Web Platform (built in Lovable)** — Dashboard, politician database, detection gallery, Twitter posting
2. **AI Worker (external Python script)** — Video processing, phone detection, face recognition → sends results to the platform via API

---

## Pages & Features

### 1. Landing Page
- Hero section explaining the project: "Os Scrollers do Parlamento"
- Live counter of total detections
- Latest catches displayed as a scrollable gallery
- Link to the X/Twitter account
- "How it works" explainer section with visual flow diagram

### 2. Detection Feed / Gallery
- Grid of all detected phone-usage moments
- Each card shows: politician photo, name, party, timestamp, video clip thumbnail
- Filter by politician, party, or date
- Clicking a card shows the video clip and links to the tweet

### 3. Politicians Database Page
- Grid of all 230 deputies from Assembleia da República
- Each card: photo, name, party, "times caught" counter
- Leaderboard/ranking of most distracted politicians
- Data scraped from parlamento.pt (names, photos, party affiliation)

### 4. Stats Dashboard
- Charts showing: detections over time, detections by party, detections by day of week
- "Worst offenders" ranking
- Average phone usage per session

---

## Backend (Supabase)

### Database Tables
- **politicians** — id, name, party, photo_url, parlamento_url, created_at
- **detections** — id, politician_id, timestamp, confidence_score, video_clip_url, screenshot_url, tweeted (boolean), tweet_url, session_date
- **sessions** — id, date, artv_stream_url, start_time, end_time, status

### Edge Functions
- **post-to-twitter** — Takes a detection and posts the clip to X/Twitter with the politician tagged
- **receive-detection** — API endpoint for the external Python worker to submit detections (with auth token)
- **scrape-politicians** — Uses Firecrawl to scrape parlamento.pt for the current list of deputies with photos

### Scheduled Jobs
- Cron job to check if parliament is in session (weekdays 10-17h)

---

## External AI Worker (Python - documentation/guide provided)

The web app will include a documentation page/README explaining how to set up the Python worker that:
1. Connects to the ARTV livestream
2. Captures frames periodically
3. Uses YOLO/similar for phone detection
4. Uses face recognition against the politician database
5. Sends detections to the Supabase API endpoint

---

## Design
- Dark theme with Portuguese parliament colors (deep blue, gold accents)
- Clean, bold typography
- Cards with subtle animations for the detection feed
- Responsive design for mobile viewing


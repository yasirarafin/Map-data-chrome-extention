# Google Maps Lead Extractor & Prospecting Pro — Phase 1 Walkthrough

This walkthrough details the architecture, features, and step-by-step instructions for installing and running the newly created **Google Maps Lead Extractor & Prospecting Pro** Chrome Extension (Manifest V3).

---

## 1. What Was Implemented

### **A. Core Scraping Engine (`content/content.js`)**
- **Dual Scraping Modes:**
  - **Deep Extraction (Default):** Sequentially clicks each business card in the Google Maps search feed, opens its full details pane, and extracts complete profile data:
    - Business name (sanitized).
    - Primary and sub-categories.
    - Google Verification / Claim Status (`UNCLAIMED` vs `VERIFIED`).
    - Full address & decomposed components (Street, City, State, ZIP, Country).
    - Phone numbers (raw local format and standardized E.164).
    - Website URL (unwrapped from Google redirect links).
    - Star ratings, review count, and distribution.
    - Day-by-day weekly operating hours schedule & live current status (Open/Closed).
    - Geo-coordinates (exact Latitude and Longitude parsed from URL/DOM).
    - Plus Code and Place ID.
    - Amenities and accessibility tags.
  - **Fast Mode:** Instantly parses visible cards directly from the left feed without opening individual panes (10x faster for quick lead aggregation).
- **Anti-Detection & Human Emulation:**
  - Smooth incremental feed scrolling.
  - Randomized jitter intervals between actions (Aggressive: 1–2s, Balanced: 2–3.5s, Stealth: 3.5–6s).
  - Resilient DOM fallbacks using semantic attributes (`aria-label`, data attributes, role feed) to prevent breaks when Google changes internal CSS classes.
- **In-Memory Deduplication:** Prevents duplicate cards from being processed during scroll iterations.

### **B. Off-Map Lead Enrichment Worker (`background/background.js`)**
- **Client-Side Background Prospecting:**
  - Fetches the business's homepage and candidate contact pages (`/contact`, `/contact-us`, `/about`).
  - **Email Extraction:** Discovers emails using `mailto:` links and email regex matching (with automatic filtering of image/asset false positives).
  - **Social Profile Discovery:** Detects direct links to LinkedIn (Company & Personal), Facebook, Instagram, Twitter/X, YouTube, and TikTok.
  - **Tech Stack & Agency Pitch Triggers:**
    - **SSL Security Check:** Validates HTTPS availability or missing certificates.
    - **CMS / Platform Detection:** Detects WordPress, Shopify, Squarespace, Wix, and Webflow.
    - **Ad Pixels & Analytics Tracking:** Identifies Google Analytics 4 (GA4), Google Tag Manager, Facebook Pixel, and TikTok Pixel (untracked businesses are prime ad agency leads).
    - **Mobile Responsiveness Check:** Viewport tag detection.

### **C. Modern Side Panel UI (`sidepanel/`)**
- Built on Chrome's **Side Panel API** (`sidepanel.html`, `sidepanel.css`, `sidepanel.js`) to stay open beside Google Maps without closing when you interact with the page.
- **Visual Design:**
  - Dark mode glassmorphic styling with `Plus Jakarta Sans` typography.
  - Pulsing live connection status badge indicating whether an active Google Maps tab is connected.
  - 4 Live Metric Cards: **Total Scraped**, **With Website**, **Emails Found**, **Unclaimed Leads**.
  - Interactive Filter Toolbar: Instant search by keyword, quick pill filters (`Has Email`, `Has Phone`, `Has Website`, `Unclaimed Only`, `⭐ 4.0+`).
  - Live Data Stream Table with business details, ratings, contact info, and technology chips.
  - Lead Inspector Modal showing opening hours tables, coordinates, and agency pitch triggers.
- **Multi-Format Export Engine:**
  - **CSV Export:** Comprehensive spreadsheet format with properly quoted values.
  - **Excel (.xls / SpreadsheetML) Export:** Native spreadsheet workbook.
  - **JSON Export:** Structured data for developer workflows and CRM integrations.

---

## 2. Project File Structure

```
c:\Development\Map data chrome extention\
├── manifest.json                  # Chrome Extension Manifest V3 configuration
├── plan.md                        # Master project specification
├── walkthrough_maps_lead_extractor.md # This implementation walkthrough
├── background/
│   └── background.js              # Background service worker & website enrichment engine
├── content/
│   └── content.js                 # Content script injected into Google Maps
├── sidepanel/
│   ├── sidepanel.html             # Dashboard UI layout
│   ├── sidepanel.css              # Custom styling & dark-mode design system
│   └── sidepanel.js               # Side panel controller, live filtering & exports
├── icons/
│   ├── icon16.png                 # 16x16 extension icon
│   ├── icon48.png                 # 48x48 extension icon
│   └── icon128.png                # 128x128 extension icon
└── scripts/
    └── generate_icons.js          # Generator script for extension icons
```

---

## 3. How to Load and Test the Extension in Google Chrome

### **Step 1: Open Chrome Extensions**
1. Open Google Chrome.
2. Navigate to `chrome://extensions` in the address bar.
3. Toggle the **Developer mode** switch in the top right corner to **ON**.

### **Step 2: Load the Unpacked Extension**
1. Click the **Load unpacked** button in the top left.
2. Browse to and select the folder:
   `C:\Development\Map data chrome extention`
3. The extension **Google Maps Lead Extractor & Prospecting Pro** will now appear in your extensions list.

### **Step 3: Pin and Open the Side Panel**
1. Click the **Puzzle icon** (Extensions menu) in the Chrome toolbar.
2. Click the **Pin** icon next to **LeadProspector PRO**.
3. Click the extension icon in your toolbar, or open the Chrome Side Panel (top right toolbar) and select **LeadProspector PRO** from the dropdown.

### **Step 4: Scrape Leads on Google Maps**
1. Navigate to [https://www.google.com/maps](https://www.google.com/maps).
2. The side panel badge will turn green: **Connected to Maps**.
3. Type any search query into Google Maps, such as:
   - `Plumbers in Miami`
   - `Dentists in New York`
   - `Restaurants in Austin`
4. In the side panel:
   - Select your scrape depth: **Deep Extraction** or **Fast Mode**.
   - Choose lead limit (e.g., 25 or 50 leads).
   - Ensure **Auto-Enrich Websites** is checked to extract emails and tech signals.
   - Click **Start Scraping**.
5. Watch leads stream live into the table with emails, phone numbers, ratings, and technology signals!
6. Click **View** on any row to inspect operating hours, coordinates, and full details.
7. Click **CSV**, **Excel**, or **JSON** to export your verified leads.

---

## 4. Phase 2 Roadmap
- [ ] **Multi-Location / Coordinate Grid Search:** Automated multi-zip code and radius grid scanning.
- [ ] **Google Sheets API Direct Sync:** Export directly to a connected Google Sheet.
- [ ] **Webhook Integration:** Real-time push to Zapier, Make, and GoHighLevel.

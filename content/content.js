// content.js - Google Maps Lead Scraping Engine

(function () {
  if (window.__G_MAPS_EXTRACTOR_LOADED__) return;
  window.__G_MAPS_EXTRACTOR_LOADED__ = true;

  let isScraping = false;
  let isPaused = false;
  let shouldStop = false;

  // Track scraped IDs to prevent duplicate processing in the same run
  const scrapedIds = new Set();

  console.log('[Maps Extractor] Content script initialized on Google Maps');

  // Listen for control commands from Side Panel
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'CHECK_GOOGLE_MAPS_STATUS': {
        const feed = findResultsFeed();
        const resultsCount = getListingElements().length;
        sendResponse({
          ready: true,
          hasFeed: !!feed,
          currentListingsCount: resultsCount,
          url: window.location.href
        });
        return false;
      }

      case 'START_SCRAPING': {
        if (isScraping) {
          sendResponse({ success: false, message: 'Scraping is already running.' });
          return false;
        }
        isScraping = true;
        isPaused = false;
        shouldStop = false;
        scrapedIds.clear();

        sendResponse({ success: true, message: 'Scraping started' });

        runScrapingLoop(request.config || {})
          .then((total) => {
            isScraping = false;
            chrome.runtime.sendMessage({
              action: 'SCRAPING_COMPLETED',
              totalScraped: total
            });
          })
          .catch((err) => {
            isScraping = false;
            chrome.runtime.sendMessage({
              action: 'SCRAPING_ERROR',
              error: err.message
            });
          });
        return true;
      }

      case 'PAUSE_SCRAPING': {
        isPaused = true;
        sendResponse({ success: true, isPaused: true });
        return false;
      }

      case 'RESUME_SCRAPING': {
        isPaused = false;
        sendResponse({ success: true, isPaused: false });
        return false;
      }

      case 'STOP_SCRAPING': {
        shouldStop = true;
        isPaused = false;
        isScraping = false;
        sendResponse({ success: true, stopped: true });
        return false;
      }

      default:
        break;
    }
  });

  /**
   * Main Scraping Coordinator
   */
  async function runScrapingLoop(config) {
    const {
      mode = 'deep', // 'fast' | 'deep'
      maxResults = 100,
      minDelay = 1500,
      maxDelay = 3000
    } = config;

    let totalExtracted = 0;
    let consecutiveNoNewItems = 0;
    const maxConsecutiveRetries = 6;

    chrome.runtime.sendMessage({
      action: 'SCRAPING_STATUS_UPDATE',
      status: 'Locating results feed...'
    });

    while (!shouldStop && totalExtracted < maxResults) {
      // Handle pause
      while (isPaused && !shouldStop) {
        await sleep(500);
      }
      if (shouldStop) break;

      const feed = findResultsFeed();
      if (!feed) {
        throw new Error('Google Maps search results feed not found. Please perform a search first (e.g. "Dentists in Miami").');
      }

      const listingCards = getListingElements();
      let foundNewInPass = false;

      for (let i = 0; i < listingCards.length; i++) {
        if (shouldStop || totalExtracted >= maxResults) break;
        while (isPaused && !shouldStop) await sleep(500);

        const card = listingCards[i];
        const cardId = getCardUniqueId(card);

        if (scrapedIds.has(cardId)) {
          continue; // Already processed
        }

        foundNewInPass = true;
        scrapedIds.add(cardId);

        chrome.runtime.sendMessage({
          action: 'SCRAPING_STATUS_UPDATE',
          status: `Processing listing ${totalExtracted + 1} of ${maxResults}...`,
          progress: { current: totalExtracted, max: maxResults }
        });

        let lead = null;

        if (mode === 'fast') {
          // Fast Mode: Scrape directly from list view
          lead = extractFastLead(card);
        } else {
          // Deep Mode: Click listing, wait for details pane, scrape everything
          lead = await extractDeepLead(card, minDelay, maxDelay);
        }

        if (lead && lead.name) {
          totalExtracted++;
          // Broadcast lead immediately to side panel
          chrome.runtime.sendMessage({
            action: 'LEAD_SCRAPED',
            lead: lead
          });
        }

        // Random jitter delay between items
        const delay = getRandomDelay(minDelay, maxDelay);
        await sleep(delay);
      }

      // Check if we hit end of list
      const isEnd = isEndOfResults();
      if (isEnd) {
        chrome.runtime.sendMessage({
          action: 'SCRAPING_STATUS_UPDATE',
          status: 'Reached the end of Google Maps results.'
        });
        break;
      }

      // Scroll the feed to load more listings
      if (!foundNewInPass) {
        consecutiveNoNewItems++;
        if (consecutiveNoNewItems >= maxConsecutiveRetries) {
          console.log('[Maps Extractor] No new items after multiple scrolls. Ending.');
          break;
        }
      } else {
        consecutiveNoNewItems = 0;
      }

      chrome.runtime.sendMessage({
        action: 'SCRAPING_STATUS_UPDATE',
        status: 'Scrolling down for more listings...'
      });

      await scrollFeed(feed);
      await sleep(1500 + Math.random() * 1000);
    }

    return totalExtracted;
  }

  /**
   * Locates Google Maps Left Results Feed Container
   */
  function findResultsFeed() {
    return (
      document.querySelector('div[role="feed"]') ||
      document.querySelector('div.m6QErb.DxyBCb.kA9KIf.dS8AEf.ecceSd') ||
      document.querySelector('div[aria-label*="Results for"]') ||
      document.querySelector('.section-scrollbox')
    );
  }

  /**
   * Retrieves all listing item elements inside the feed
   */
  function getListingElements() {
    const feed = findResultsFeed();
    if (!feed) return [];

    // Anchor with hfpxzc class is standard Google Maps card anchor
    const links = Array.from(feed.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]'));
    if (links.length > 0) {
      return links.map((a) => a.closest('div.Nv2PK') || a.parentElement || a);
    }

    // Fallback: items with class Nv2PK or THOPZb
    return Array.from(feed.querySelectorAll('div.Nv2PK, div.THOPZb, div.fontHeadlineSmall'));
  }

  /**
   * Checks if Google Maps reached end of results
   */
  function isEndOfResults() {
    const bodyText = document.body.innerText || '';
    return (
      bodyText.includes("You've reached the end of the list") ||
      bodyText.includes("No more results") ||
      !!document.querySelector('span.HlvSq')
    );
  }

  /**
   * Scroll down the feed smoothly
   */
  async function scrollFeed(feed) {
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    // Also dispatch mousewheel/scroll event
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  /**
   * Generates a stable unique identifier for a feed card
   */
  function getCardUniqueId(card) {
    const anchor = card.querySelector('a.hfpxzc') || card.querySelector('a[href*="/maps/place/"]');
    if (anchor && anchor.href) {
      const match = anchor.href.match(/place\/([^/]+)/);
      if (match && match[1]) return decodeURIComponent(match[1]);
      return anchor.href;
    }
    const titleEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall');
    if (titleEl) return titleEl.innerText.trim();
    return Math.random().toString(36).substring(2);
  }

  /**
   * Fast Mode Extraction: Extract from feed DOM without clicking
   */
  function extractFastLead(card) {
    const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall') || card.querySelector('a.hfpxzc');
    const name = nameEl ? (nameEl.innerText || nameEl.getAttribute('aria-label') || '').trim() : '';

    if (!name) return null;

    const anchor = card.querySelector('a.hfpxzc') || card.querySelector('a[href*="/maps/place/"]');
    const mapsUrl = anchor ? anchor.href : window.location.href;

    // Rating & reviews
    const ratingEl = card.querySelector('.MW4etd, span.ZkP5Je, span[aria-label*="stars"]');
    const rating = ratingEl ? parseFloat(ratingEl.innerText.replace(',', '.') || ratingEl.getAttribute('aria-label')) : null;

    const reviewsEl = card.querySelector('.UY7F9, span[aria-label*="reviews"]');
    let reviewCount = 0;
    if (reviewsEl) {
      const revText = reviewsEl.innerText || reviewsEl.getAttribute('aria-label') || '';
      const revMatch = revText.replace(/[,.]/g, '').match(/\d+/);
      if (revMatch) reviewCount = parseInt(revMatch[0], 10);
    }

    // Row texts for category, address, phone
    const rowSpans = Array.from(card.querySelectorAll('.W4Efsd span, .fontBodyMedium span'));
    let category = '';
    let address = '';
    let phone = '';

    rowSpans.forEach((span) => {
      const t = span.innerText.trim();
      if (!t || t === '·') return;
      if (/^\+?[0-9\s().-]{7,}$/.test(t)) {
        if (!phone) phone = t;
      } else if (!category && !t.includes('Open') && !t.includes('Closed') && !t.includes('$')) {
        category = t;
      } else if (!address && t.length > 5 && !t.includes('Open') && !t.includes('Closed')) {
        address = t;
      }
    });

    // Check website button
    const websiteEl = card.querySelector('a[data-value="Website"], a[aria-label*="Website"], a[href^="http"]:not([href*="google.com"])');
    const website = websiteEl ? cleanExternalUrl(websiteEl.href) : '';

    // Coordinates from URL
    const coords = parseCoordinates(mapsUrl);

    return {
      id: generateLeadId(name, phone, address),
      name,
      primaryCategory: category,
      subCategories: [],
      claimStatus: 'Unknown (Fast Mode)',
      address: {
        full: address,
        street: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      },
      phone: {
        raw: phone,
        formatted: formatE164(phone)
      },
      website: website,
      googleMapsUrl: mapsUrl,
      placeId: parsePlaceId(mapsUrl),
      coordinates: coords,
      plusCode: '',
      rating: rating || 0,
      reviewCount: reviewCount || 0,
      reviewDistribution: null,
      operatingSchedule: {},
      currentStatus: '',
      priceLevel: '',
      amenities: [],
      scrapeDate: new Date().toISOString()
    };
  }

  /**
   * Deep Mode Extraction: Clicks card, opens detail panel, extracts all attributes
   */
  async function extractDeepLead(card, minDelay, maxDelay) {
    const anchor = card.querySelector('a.hfpxzc') || card.querySelector('a[href*="/maps/place/"]') || card;
    
    // Scroll card into view and click
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    anchor.click();

    // Wait for the detail panel to open and load title
    const detailPane = await waitForDetailPane();
    if (!detailPane) {
      // Fallback to fast mode if pane didn't open
      return extractFastLead(card);
    }

    // Small delay to let all async info populate
    await sleep(600 + Math.random() * 400);

    const mapsUrl = window.location.href;

    // 1. Business Name
    const titleEl =
      detailPane.querySelector('h1.DUwDvf') ||
      detailPane.querySelector('h1.fontHeadlineLarge') ||
      detailPane.querySelector('div.fontHeadlineLarge');
    const name = titleEl ? cleanBusinessName(titleEl.innerText) : '';
    if (!name) return extractFastLead(card);

    // 2. Categories
    const primaryCatEl = detailPane.querySelector('button.DkEaL, button[jsaction*="category"]');
    const primaryCategory = primaryCatEl ? primaryCatEl.innerText.trim() : '';

    const subCategories = [];
    const catButtons = detailPane.querySelectorAll('button.DkEaL, button[jsaction*="category"]');
    catButtons.forEach((btn, idx) => {
      if (idx > 0 && btn.innerText.trim()) {
        subCategories.push(btn.innerText.trim());
      }
    });

    // 3. Claim / Verification Status
    const claimEl = detailPane.querySelector('button[aria-label*="Claim this business"], a[href*="business.google.com/create"], [data-item-id*="merchant"]');
    const pageText = detailPane.innerText || '';
    const isUnclaimed =
      !!claimEl ||
      pageText.includes('Claim this business') ||
      pageText.includes('Own this business?');
    const claimStatus = isUnclaimed ? 'UNCLAIMED' : 'VERIFIED';

    // 4. Contact & Address
    const addressEl = detailPane.querySelector('button[data-item-id="address"], [data-item-id*="address"]');
    const fullAddress = addressEl ? cleanFieldText(addressEl.innerText || addressEl.getAttribute('aria-label')) : '';
    const parsedAddress = parseAddressComponents(fullAddress);

    const phoneEl = detailPane.querySelector('button[data-item-id^="phone:tel:"], [data-item-id*="phone"]');
    const rawPhone = phoneEl ? cleanFieldText(phoneEl.innerText || phoneEl.getAttribute('aria-label')) : '';

    const websiteEl = detailPane.querySelector('a[data-item-id="authority"], a[aria-label*="Website"]');
    const website = websiteEl ? cleanExternalUrl(websiteEl.href) : '';

    const plusCodeEl = detailPane.querySelector('button[data-item-id="oloc"], [data-item-id*="oloc"]');
    const plusCode = plusCodeEl ? cleanFieldText(plusCodeEl.innerText) : '';

    // 5. Ratings, Reviews, and Breakdown
    let rating = 0;
    const ratingEl = detailPane.querySelector('div.F7nice span[aria-hidden="true"], span.ceNzKf');
    if (ratingEl) {
      rating = parseFloat(ratingEl.innerText.replace(',', '.'));
    }

    let reviewCount = 0;
    const revCountEl = detailPane.querySelector('div.F7nice span:last-child, span[aria-label*="reviews"]');
    if (revCountEl) {
      const match = (revCountEl.innerText || revCountEl.getAttribute('aria-label') || '').replace(/[,.]/g, '').match(/\d+/);
      if (match) reviewCount = parseInt(match[0], 10);
    }

    // 6. Operating Hours & Current Status
    const hoursData = extractOperatingHours(detailPane);

    // 7. Amenities / Service Tags
    const amenities = extractAmenities(detailPane);

    // 8. Coordinates & Place ID
    const coords = parseCoordinates(mapsUrl);
    const placeId = parsePlaceId(mapsUrl);

    return {
      id: generateLeadId(name, rawPhone, fullAddress),
      name,
      primaryCategory,
      subCategories,
      claimStatus,
      address: parsedAddress,
      phone: {
        raw: rawPhone,
        formatted: formatE164(rawPhone)
      },
      website,
      googleMapsUrl: mapsUrl,
      placeId,
      coordinates: coords,
      plusCode,
      rating: isNaN(rating) ? 0 : rating,
      reviewCount: isNaN(reviewCount) ? 0 : reviewCount,
      operatingSchedule: hoursData.schedule,
      currentStatus: hoursData.currentStatus,
      amenities,
      scrapeDate: new Date().toISOString()
    };
  }

  /**
   * Waits for the detail pane to appear
   */
  async function waitForDetailPane(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const pane =
        document.querySelector('div[role="main"]') ||
        document.querySelector('div.m6QErb[aria-label]') ||
        document.querySelector('div.TIHn2');
      if (pane && (pane.querySelector('h1') || pane.querySelector('.fontHeadlineLarge'))) {
        return pane;
      }
      await sleep(150);
    }
    return null;
  }

  /**
   * Extracts operating hours table and current status
   */
  function extractOperatingHours(pane) {
    const result = { currentStatus: '', schedule: {} };

    // Status (e.g. Open now, Closed, Closes at 9 PM)
    const statusEl = pane.querySelector('.ZDu9vd, [data-item-id="oh"]');
    if (statusEl) {
      result.currentStatus = statusEl.innerText.split('\n')[0].trim();
    }

    // Attempt to parse weekly schedule table if present
    const table = pane.querySelector('table.eKjhbv, table[aria-label*="Hours"]');
    if (table) {
      const rows = table.querySelectorAll('tr');
      rows.forEach((tr) => {
        const dayEl = tr.querySelector('td:first-child');
        const hoursEl = tr.querySelector('td:last-child');
        if (dayEl && hoursEl) {
          result.schedule[dayEl.innerText.trim()] = hoursEl.innerText.trim();
        }
      });
    }

    return result;
  }

  /**
   * Extracts accessibility, payments, and service amenities
   */
  function extractAmenities(pane) {
    const tags = new Set();
    const chips = pane.querySelectorAll('div.E0dtEd span, div.LTK0O, button[aria-label*="accessibility"]');
    chips.forEach((c) => {
      const t = c.innerText.trim();
      if (t && t.length < 50 && !t.includes('★')) {
        tags.add(t);
      }
    });
    return Array.from(tags);
  }

  /**
   * Parse Latitude and Longitude from Google Maps URL
   */
  function parseCoordinates(url) {
    if (!url) return { lat: null, lng: null };
    // Matches @40.712776,-74.005974,15z
    const match1 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (match1) {
      return { lat: parseFloat(match1[1]), lng: parseFloat(match1[2]) };
    }
    // Matches !3d40.712776!4d-74.005974
    const match2 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (match2) {
      return { lat: parseFloat(match2[1]), lng: parseFloat(match2[2]) };
    }
    return { lat: null, lng: null };
  }

  /**
   * Parse Place ID from URL
   */
  function parsePlaceId(url) {
    if (!url) return '';
    const match = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (match) return match[1];
    const chIdMatch = url.match(/1s([^!&]+)/);
    if (chIdMatch) return chIdMatch[1];
    return '';
  }

  /**
   * Splits a formatted address line into street, city, state, zip, country
   */
  function parseAddressComponents(fullAddress) {
    const parsed = {
      full: fullAddress,
      street: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    };
    if (!fullAddress) return parsed;

    const parts = fullAddress.split(',').map((p) => p.trim());
    if (parts.length === 1) {
      parsed.street = parts[0];
    } else if (parts.length === 2) {
      parsed.street = parts[0];
      parsed.city = parts[1];
    } else if (parts.length >= 3) {
      parsed.street = parts[0];
      parsed.city = parts[1];
      const stateZip = parts[2];
      const stateZipMatch = stateZip.match(/([A-Za-z\s]+)\s+(\d{4,10})/);
      if (stateZipMatch) {
        parsed.state = stateZipMatch[1].trim();
        parsed.zip = stateZipMatch[2].trim();
      } else {
        parsed.state = stateZip;
      }
      if (parts.length >= 4) {
        parsed.country = parts[parts.length - 1];
      }
    }
    return parsed;
  }

  /**
   * Cleans clean title text removing emojis or weird symbols
   */
  function cleanBusinessName(name) {
    return name ? name.replace(/[\r\n\t]+/g, ' ').trim() : '';
  }

  /**
   * Cleans text fields (strips phone: prefix, icon labels)
   */
  function cleanFieldText(text) {
    if (!text) return '';
    return text
      .replace(/^phone:\s*/i, '')
      .replace(/^address:\s*/i, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
  }

  /**
   * Unwraps Google redirect URLs
   */
  function cleanExternalUrl(url) {
    if (!url) return '';
    try {
      if (url.includes('google.com/url?') || url.includes('/url?q=')) {
        const parsed = new URL(url);
        const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (target) return target;
      }
      return url;
    } catch (_) {
      return url;
    }
  }

  /**
   * Standardizes phone numbers to E.164-like digits format
   */
  function formatE164(phone) {
    if (!phone) return '';
    const digitsOnly = phone.replace(/[^\d+]/g, '');
    return digitsOnly;
  }

  /**
   * Creates a reproducible unique ID for deduplication
   */
  function generateLeadId(name, phone, address) {
    const raw = `${name}_${phone || ''}_${address || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    return raw || Math.random().toString(36).substring(2);
  }

  function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();

// background.js - Service Worker for Google Maps Lead Extractor

// Configure side panel to open when action icon is clicked
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('sidePanel.setPanelBehavior error:', err);
    });
  }
});

// Listen for messages from Side Panel and Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ENRICH_WEBSITE') {
    handleEnrichWebsite(message.websiteUrl)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'PING_BACKGROUND') {
    sendResponse({ success: true, status: 'ready' });
    return false;
  }
});

/**
 * Normalizes URL and handles fetching with timeout
 */
function normalizeUrl(url) {
  if (!url) return null;
  let clean = url.trim();
  // Remove google redirect wrapper if present
  if (clean.includes('google.com/url?') || clean.includes('/url?q=')) {
    try {
      const parsed = new URL(clean, 'https://www.google.com');
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (target) clean = target;
    } catch (_) {}
  }
  if (!/^https?:\/\//i.test(clean)) {
    clean = 'https://' + clean;
  }
  return clean;
}

/**
 * Performs website enrichment: Email extraction, Social handles, CMS detection, Pixel tracking
 */
async function handleEnrichWebsite(rawUrl) {
  const targetUrl = normalizeUrl(rawUrl);
  if (!targetUrl) {
    return { emails: [], socials: {}, tech: { ssl: false, cms: 'Unknown', pixels: [] } };
  }

  let ssl = targetUrl.toLowerCase().startsWith('https://');
  const emailsSet = new Set();
  const socials = {
    facebook: null,
    instagram: null,
    linkedin: null,
    twitter: null,
    youtube: null,
    tiktok: null
  };
  const detectedCms = new Set();
  const detectedPixels = new Set();
  let mobileOptimized = false;

  // Helper fetch with timeout
  async function fetchPage(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }

  // Parse HTML page
  function parseHtml(html, pageUrl) {
    if (!html) return;

    // Viewport check (mobile responsiveness)
    if (/<meta[^>]+name=["']viewport["']/i.test(html)) {
      mobileOptimized = true;
    }

    // Email extraction: mailto links
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
      const email = match[1].toLowerCase();
      if (isValidEmail(email)) emailsSet.add(email);
    }

    // Generic email regex match
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    while ((match = emailRegex.exec(html)) !== null) {
      const email = match[0].toLowerCase();
      if (isValidEmail(email)) emailsSet.add(email);
    }

    // Social Links
    const hrefRegex = /href=["']([^"']+)["']/gi;
    while ((match = hrefRegex.exec(html)) !== null) {
      const link = match[1].trim();
      inspectSocialLink(link, socials);
    }

    // CMS & Platform Detection
    if (/wp-content|wp-includes|wp-json|<meta[^>]+content=["'][^"']*WordPress/i.test(html)) {
      detectedCms.add('WordPress');
    }
    if (/cdn\.shopify\.com|Shopify\.theme|Shopify\.Checkout/i.test(html)) {
      detectedCms.add('Shopify');
    }
    if (/squarespace\.com|static1\.squarespace\.com/i.test(html)) {
      detectedCms.add('Squarespace');
    }
    if (/wix\.com|wixstatic\.com|_wix/i.test(html)) {
      detectedCms.add('Wix');
    }
    if (/webflow\.com|wf-page/i.test(html)) {
      detectedCms.add('Webflow');
    }

    // Ad Pixels & Analytics Tracking
    if (/gtag\(['"]config['"],\s*['"]G-/i.test(html) || /googletagmanager\.com\/gtag\/js\?id=G-/i.test(html)) {
      detectedPixels.add('GA4');
    }
    if (/googletagmanager\.com\/gtm\.js/i.test(html)) {
      detectedPixels.add('Google Tag Manager');
    }
    if (/fbq\(['"]init['"]/i.test(html) || /connect\.facebook\.net\/[^"']+\/fbevents\.js/i.test(html)) {
      detectedPixels.add('Facebook Pixel');
    }
    if (/ttq\.load|analytics\.tiktok\.com/i.test(html)) {
      detectedPixels.add('TikTok Pixel');
    }
  }

  // 1. Fetch Homepage
  const homeHtml = await fetchPage(targetUrl);
  if (homeHtml) {
    parseHtml(homeHtml, targetUrl);

    // 2. If no email found on homepage, attempt to check /contact or /about
    if (emailsSet.size === 0) {
      try {
        const u = new URL(targetUrl);
        const contactCandidates = [
          `${u.origin}/contact`,
          `${u.origin}/contact-us`,
          `${u.origin}/about`,
          `${u.origin}/about-us`
        ];

        // Fetch first available contact page
        for (const candidate of contactCandidates) {
          const subHtml = await fetchPage(candidate, 5000);
          if (subHtml) {
            parseHtml(subHtml, candidate);
            if (emailsSet.size > 0) break;
          }
        }
      } catch (_) {}
    }
  } else {
    // If https failed, fallback check if http responds (means SSL issue)
    if (ssl) {
      const httpFallback = targetUrl.replace(/^https:\/\//i, 'http://');
      const httpHtml = await fetchPage(httpFallback, 5000);
      if (httpHtml) {
        ssl = false; // Works on HTTP but failed on HTTPS! Great pitch trigger!
        parseHtml(httpHtml, httpFallback);
      }
    }
  }

  return {
    emails: Array.from(emailsSet).slice(0, 5), // top 5 valid emails
    socials,
    tech: {
      ssl,
      cms: detectedCms.size > 0 ? Array.from(detectedCms).join(', ') : 'Custom / Other',
      pixels: Array.from(detectedPixels),
      mobileOptimized
    }
  };
}

/**
 * Filter out invalid / dummy emails
 */
function isValidEmail(email) {
  if (!email || email.length > 80) return false;
  const invalidExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];
  if (invalidExtensions.some(ext => email.endsWith(ext))) return false;
  const invalidDomains = ['sentry.io', 'example.com', 'domain.com', 'yourdomain.com', 'email.com', 'wixpress.com'];
  if (invalidDomains.some(d => email.includes(d))) return false;
  return true;
}

/**
 * Checks URL for known social media patterns
 */
function inspectSocialLink(rawLink, socials) {
  if (!rawLink || rawLink.startsWith('#') || rawLink.startsWith('javascript:')) return;
  const lower = rawLink.toLowerCase();

  if (lower.includes('linkedin.com/company/') || lower.includes('linkedin.com/in/')) {
    if (!socials.linkedin) socials.linkedin = cleanSocialUrl(rawLink);
  } else if (lower.includes('facebook.com/') && !lower.includes('/sharer')) {
    if (!socials.facebook) socials.facebook = cleanSocialUrl(rawLink);
  } else if (lower.includes('instagram.com/') && !lower.includes('/p/')) {
    if (!socials.instagram) socials.instagram = cleanSocialUrl(rawLink);
  } else if (lower.includes('twitter.com/') || lower.includes('x.com/')) {
    if (!socials.twitter && !lower.includes('/intent/')) socials.twitter = cleanSocialUrl(rawLink);
  } else if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
    if (!socials.youtube) socials.youtube = cleanSocialUrl(rawLink);
  } else if (lower.includes('tiktok.com/@')) {
    if (!socials.tiktok) socials.tiktok = cleanSocialUrl(rawLink);
  }
}

function cleanSocialUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

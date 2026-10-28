// sidepanel.js - Controller for Google Maps Lead Extractor Side Panel

(function () {
  // Application State
  const state = {
    leads: [],
    filteredLeads: [],
    isScraping: false,
    isPaused: false,
    activeFilter: 'all',
    searchQuery: '',
    currentTabId: null,
    isGoogleMapsTab: false
  };

  // DOM Elements Cache
  const elements = {
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    connectionBanner: document.getElementById('connectionBanner'),
    btnOpenMaps: document.getElementById('btnOpenMaps'),

    modeDeep: document.getElementById('modeDeep'),
    modeFast: document.getElementById('modeFast'),
    maxResultsInput: document.getElementById('maxResultsInput'),
    delaySelect: document.getElementById('delaySelect'),
    enrichWebsitesToggle: document.getElementById('enrichWebsitesToggle'),

    btnStart: document.getElementById('btnStart'),
    btnPause: document.getElementById('btnPause'),
    btnStop: document.getElementById('btnStop'),

    progressContainer: document.getElementById('progressContainer'),
    progressBar: document.getElementById('progressBar'),
    progressStatusText: document.getElementById('progressStatusText'),
    progressCountText: document.getElementById('progressCountText'),

    statTotal: document.getElementById('statTotal'),
    statWebsites: document.getElementById('statWebsites'),
    statEmails: document.getElementById('statEmails'),
    statUnclaimed: document.getElementById('statUnclaimed'),

    searchInput: document.getElementById('searchInput'),
    filterPills: document.querySelectorAll('.filter-pill'),
    filteredCountBadge: document.getElementById('filteredCountBadge'),
    btnClearData: document.getElementById('btnClearData'),

    leadsTableBody: document.getElementById('leadsTableBody'),

    btnExportCsv: document.getElementById('btnExportCsv'),
    btnExportExcel: document.getElementById('btnExportExcel'),
    btnExportJson: document.getElementById('btnExportJson'),

    leadModal: document.getElementById('leadModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalCategory: document.getElementById('modalCategory'),
    modalBody: document.getElementById('modalBody'),
    btnModalClose: document.getElementById('btnModalClose')
  };

  let currentScrapeMode = 'deep';

  // Initialize
  init();

  async function init() {
    loadSavedLeads();
    setupEventListeners();
    await checkActiveTab();

    // Listen for tab changes
    chrome.tabs.onActivated.addListener(checkActiveTab);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === state.currentTabId && changeInfo.status === 'complete') {
        checkActiveTab();
      }
    });

    // Listen for messages from content script or background
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  /**
   * Load previously scraped leads from chrome.storage
   */
  function loadSavedLeads() {
    chrome.storage.local.get(['gmaps_leads'], (result) => {
      if (result.gmaps_leads && Array.isArray(result.gmaps_leads)) {
        state.leads = result.gmaps_leads;
        applyFiltersAndRender();
        updateStats();
      }
    });
  }

  function saveLeadsToStorage() {
    chrome.storage.local.set({ gmaps_leads: state.leads });
  }

  /**
   * Check if current tab is Google Maps
   */
  async function checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        setConnectionState(false, 'No Active Tab');
        return;
      }

      state.currentTabId = tab.id;
      const isMaps = tab.url.includes('google.com/maps') || tab.url.includes('maps.google.com');
      state.isGoogleMapsTab = isMaps;

      if (isMaps) {
        setConnectionState(true, 'Connected to Maps');
        elements.connectionBanner.classList.add('hidden');
      } else {
        setConnectionState(false, 'Maps Tab Inactive');
        elements.connectionBanner.classList.remove('hidden');
      }
    } catch (e) {
      setConnectionState(false, 'Connection Error');
    }
  }

  function setConnectionState(connected, text) {
    elements.statusText.innerText = text;
    if (connected) {
      elements.statusBadge.classList.remove('disconnected');
      elements.statusBadge.classList.add('connected');
    } else {
      elements.statusBadge.classList.remove('connected');
      elements.statusBadge.classList.add('disconnected');
    }
  }

  /**
   * Event Listeners
   */
  function setupEventListeners() {
    // Open Google Maps button
    elements.btnOpenMaps.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.google.com/maps' });
    });

    // Scrape Mode toggle
    elements.modeDeep.addEventListener('click', () => {
      currentScrapeMode = 'deep';
      elements.modeDeep.classList.add('active');
      elements.modeFast.classList.remove('active');
    });

    elements.modeFast.addEventListener('click', () => {
      currentScrapeMode = 'fast';
      elements.modeFast.classList.add('active');
      elements.modeDeep.classList.remove('active');
    });

    // Control Buttons
    elements.btnStart.addEventListener('click', handleStartScraping);
    elements.btnPause.addEventListener('click', handlePauseResumeScraping);
    elements.btnStop.addEventListener('click', handleStopScraping);

    // Filter Pills
    elements.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        elements.filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        state.activeFilter = pill.getAttribute('data-filter');
        applyFiltersAndRender();
      });
    });

    // Search query input
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      applyFiltersAndRender();
    });

    // Clear Data
    elements.btnClearData.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all extracted leads?')) {
        state.leads = [];
        saveLeadsToStorage();
        applyFiltersAndRender();
        updateStats();
      }
    });

    // Export Buttons
    elements.btnExportCsv.addEventListener('click', exportToCsv);
    elements.btnExportExcel.addEventListener('click', exportToExcel);
    elements.btnExportJson.addEventListener('click', exportToJson);

    // Modal Close
    elements.btnModalClose.addEventListener('click', closeModal);
    elements.leadModal.addEventListener('click', (e) => {
      if (e.target === elements.leadModal) closeModal();
    });
  }

  /**
   * Start Scraping Trigger
   */
  async function handleStartScraping() {
    await checkActiveTab();
    if (!state.isGoogleMapsTab) {
      alert('Please switch to a Google Maps tab with active search results first!');
      return;
    }

    const maxResults = parseInt(elements.maxResultsInput.value, 10);
    const speed = elements.delaySelect.value;
    let minDelay = 1500;
    let maxDelay = 3000;

    if (speed === 'fast') {
      minDelay = 800;
      maxDelay = 1800;
    } else if (speed === 'stealth') {
      minDelay = 3500;
      maxDelay = 6000;
    }

    const config = {
      mode: currentScrapeMode,
      maxResults,
      minDelay,
      maxDelay
    };

    try {
      chrome.tabs.sendMessage(
        state.currentTabId,
        { action: 'START_SCRAPING', config },
        (response) => {
          if (chrome.runtime.lastError) {
            alert('Cannot connect to Google Maps page. Please refresh the Google Maps tab and try again.');
            return;
          }

          if (response && response.success) {
            state.isScraping = true;
            state.isPaused = false;
            updateControlsUI();
            elements.progressContainer.classList.remove('hidden');
            elements.progressBar.style.width = '0%';
            elements.progressStatusText.innerText = 'Scraping started...';
            elements.progressCountText.innerText = `0 / ${maxResults}`;
          } else {
            alert(response ? response.message : 'Failed to start scraper.');
          }
        }
      );
    } catch (e) {
      alert('Error communicating with Google Maps tab: ' + e.message);
    }
  }

  /**
   * Pause / Resume Scraping
   */
  function handlePauseResumeScraping() {
    if (!state.isScraping) return;

    if (!state.isPaused) {
      // Pause
      chrome.tabs.sendMessage(state.currentTabId, { action: 'PAUSE_SCRAPING' }, (res) => {
        if (res && res.isPaused) {
          state.isPaused = true;
          elements.btnPause.innerText = 'Resume';
          elements.progressStatusText.innerText = 'Scraping paused';
        }
      });
    } else {
      // Resume
      chrome.tabs.sendMessage(state.currentTabId, { action: 'RESUME_SCRAPING' }, (res) => {
        if (res && !res.isPaused) {
          state.isPaused = false;
          elements.btnPause.innerText = 'Pause';
          elements.progressStatusText.innerText = 'Resuming...';
        }
      });
    }
  }

  /**
   * Stop Scraping
   */
  function handleStopScraping() {
    if (!state.isScraping) return;

    chrome.tabs.sendMessage(state.currentTabId, { action: 'STOP_SCRAPING' }, () => {
      state.isScraping = false;
      state.isPaused = false;
      updateControlsUI();
      elements.progressStatusText.innerText = 'Scraping stopped by user.';
    });
  }

  function updateControlsUI() {
    elements.btnStart.disabled = state.isScraping;
    elements.btnPause.disabled = !state.isScraping;
    elements.btnStop.disabled = !state.isScraping;
    elements.modeDeep.disabled = state.isScraping;
    elements.modeFast.disabled = state.isScraping;
    elements.btnPause.innerText = 'Pause';
  }

  /**
   * Handle incoming runtime messages
   */
  function handleRuntimeMessage(message, sender, sendResponse) {
    if (message.action === 'LEAD_SCRAPED') {
      onLeadCaptured(message.lead);
    } else if (message.action === 'SCRAPING_STATUS_UPDATE') {
      elements.progressStatusText.innerText = message.status;
      if (message.progress) {
        const { current, max } = message.progress;
        const pct = Math.min(100, Math.round((current / max) * 100));
        elements.progressBar.style.width = `${pct}%`;
        elements.progressCountText.innerText = `${current} / ${max}`;
      }
    } else if (message.action === 'SCRAPING_COMPLETED') {
      state.isScraping = false;
      state.isPaused = false;
      updateControlsUI();
      elements.progressBar.style.width = '100%';
      elements.progressStatusText.innerText = `Completed! Scraped ${message.totalScraped} leads.`;
    } else if (message.action === 'SCRAPING_ERROR') {
      state.isScraping = false;
      state.isPaused = false;
      updateControlsUI();
      elements.progressStatusText.innerText = `Error: ${message.error}`;
      alert(`Scraping Error: ${message.error}`);
    }
  }

  /**
   * Process and store newly captured lead
   */
  function onLeadCaptured(lead) {
    // Deduplication check
    const existingIndex = state.leads.findIndex(
      (l) => (l.placeId && lead.placeId && l.placeId === lead.placeId) || (l.id && lead.id && l.id === lead.id)
    );

    if (existingIndex >= 0) {
      // Merge / update existing
      state.leads[existingIndex] = { ...state.leads[existingIndex], ...lead };
    } else {
      state.leads.unshift(lead);
    }

    saveLeadsToStorage();
    updateStats();
    applyFiltersAndRender();

    // Check if website auto-enrichment is enabled
    if (elements.enrichWebsitesToggle.checked && lead.website) {
      enrichLeadWebsite(lead);
    }
  }

  /**
   * Off-Map website enrichment call to background script
   */
  function enrichLeadWebsite(lead) {
    chrome.runtime.sendMessage(
      { action: 'ENRICH_WEBSITE', websiteUrl: lead.website },
      (response) => {
        if (response && response.success && response.data) {
          const { emails, socials, tech } = response.data;
          const idx = state.leads.findIndex((l) => l.id === lead.id);
          if (idx >= 0) {
            state.leads[idx].emails = emails || [];
            state.leads[idx].socials = socials || {};
            state.leads[idx].techSignals = tech || {};
            saveLeadsToStorage();
            updateStats();
            applyFiltersAndRender();
          }
        }
      }
    );
  }

  /**
   * Update metric cards
   */
  function updateStats() {
    elements.statTotal.innerText = state.leads.length;

    const withWeb = state.leads.filter((l) => l.website).length;
    elements.statWebsites.innerText = withWeb;

    const withEmail = state.leads.filter((l) => l.emails && l.emails.length > 0).length;
    elements.statEmails.innerText = withEmail;

    const unclaimed = state.leads.filter((l) => l.claimStatus === 'UNCLAIMED').length;
    elements.statUnclaimed.innerText = unclaimed;
  }

  /**
   * Apply filters and render table
   */
  function applyFiltersAndRender() {
    let filtered = [...state.leads];

    // Filter pills
    if (state.activeFilter === 'has-email') {
      filtered = filtered.filter((l) => l.emails && l.emails.length > 0);
    } else if (state.activeFilter === 'has-phone') {
      filtered = filtered.filter((l) => l.phone && (l.phone.raw || l.phone.formatted));
    } else if (state.activeFilter === 'has-website') {
      filtered = filtered.filter((l) => l.website);
    } else if (state.activeFilter === 'unclaimed') {
      filtered = filtered.filter((l) => l.claimStatus === 'UNCLAIMED');
    } else if (state.activeFilter === 'rating-4') {
      filtered = filtered.filter((l) => l.rating >= 4.0);
    }

    // Text search query
    if (state.searchQuery) {
      const q = state.searchQuery;
      filtered = filtered.filter((l) => {
        const nameMatch = (l.name || '').toLowerCase().includes(q);
        const catMatch = (l.primaryCategory || '').toLowerCase().includes(q);
        const phoneMatch = (l.phone?.raw || '').includes(q);
        const emailMatch = (l.emails || []).some((e) => e.toLowerCase().includes(q));
        const cityMatch = (l.address?.city || l.address?.full || '').toLowerCase().includes(q);
        return nameMatch || catMatch || phoneMatch || emailMatch || cityMatch;
      });
    }

    state.filteredLeads = filtered;
    elements.filteredCountBadge.innerText = filtered.length;

    renderTable(filtered);
  }

  /**
   * Render leads into HTML table
   */
  function renderTable(leads) {
    if (leads.length === 0) {
      elements.leadsTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>No leads match current filter.</p>
              <span>Try adjusting your search query or scrape new leads.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    let rowsHtml = '';
    leads.forEach((lead, index) => {
      const isUnclaimed = lead.claimStatus === 'UNCLAIMED';
      const rowClass = isUnclaimed ? 'unclaimed-row' : '';
      const phoneDisplay = lead.phone?.formatted || lead.phone?.raw || '—';
      const emailsList = lead.emails && lead.emails.length > 0 ? lead.emails[0] : '—';
      const ratingDisplay = lead.rating ? `★ ${lead.rating} (${lead.reviewCount})` : '—';

      // Tech signals chips
      let techChips = '';
      if (lead.techSignals) {
        if (lead.techSignals.cms && lead.techSignals.cms !== 'Unknown' && lead.techSignals.cms !== 'Custom / Other') {
          techChips += `<span class="tech-chip cms">${escapeHtml(lead.techSignals.cms)}</span>`;
        }
        if (lead.techSignals.pixels && lead.techSignals.pixels.length > 0) {
          techChips += `<span class="tech-chip pixel">${escapeHtml(lead.techSignals.pixels[0])}</span>`;
        }
        if (lead.techSignals.ssl === false) {
          techChips += `<span class="tech-chip" style="color:#ef4444">No SSL</span>`;
        }
      }
      if (!techChips) techChips = '<span style="color:#64748b">—</span>';

      rowsHtml += `
        <tr class="${rowClass}">
          <td style="color:#64748b; font-family:var(--font-mono)">${index + 1}</td>
          <td>
            <div class="business-cell">
              <span class="biz-name" title="${escapeHtml(lead.name)}">${escapeHtml(lead.name)}</span>
              <span class="biz-cat">${escapeHtml(lead.primaryCategory || 'Business')}</span>
              ${isUnclaimed ? '<span class="pill-tag pill-unclaimed">Unclaimed</span>' : ''}
            </div>
          </td>
          <td>
            <div class="contact-cell">
              <span>${escapeHtml(phoneDisplay)}</span>
              ${lead.website ? `<a href="${escapeHtml(lead.website)}" target="_blank" style="color:#38bdf8; font-size:10px; text-decoration:none">Visit Web ↗</a>` : ''}
            </div>
          </td>
          <td>
            <span class="email-tag">${escapeHtml(emailsList)}</span>
          </td>
          <td>
            <span class="star-rating">${ratingDisplay}</span>
          </td>
          <td>
            <div class="tech-pills">${techChips}</div>
          </td>
          <td>
            <button class="btn-text btn-inspect" data-id="${lead.id}" style="color:#818cf8; font-weight:600">
              View
            </button>
          </td>
        </tr>
      `;
    });

    elements.leadsTableBody.innerHTML = rowsHtml;

    // Attach inspect click handlers
    const inspectButtons = elements.leadsTableBody.querySelectorAll('.btn-inspect');
    inspectButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const lead = state.leads.find((l) => l.id === id);
        if (lead) openModal(lead);
      });
    });
  }

  /**
   * Detail Modal Presentation
   */
  function openModal(lead) {
    elements.modalTitle.innerText = lead.name;
    elements.modalCategory.innerText = `${lead.primaryCategory || 'General Business'} · Status: ${lead.claimStatus || 'Verified'}`;

    let scheduleHtml = '<em>No schedule captured.</em>';
    if (lead.operatingSchedule && Object.keys(lead.operatingSchedule).length > 0) {
      scheduleHtml = '<table class="hours-table">';
      for (const [day, hours] of Object.entries(lead.operatingSchedule)) {
        scheduleHtml += `<tr><td>${escapeHtml(day)}</td><td>${escapeHtml(hours)}</td></tr>`;
      }
      scheduleHtml += '</table>';
    }

    let emailsHtml = (lead.emails && lead.emails.length > 0)
      ? lead.emails.map((e) => `<a href="mailto:${escapeHtml(e)}" style="color:#c084fc">${escapeHtml(e)}</a>`).join(', ')
      : '<em>No emails extracted yet.</em>';

    let socialsHtml = '<em>No social profiles found.</em>';
    if (lead.socials) {
      const links = [];
      for (const [net, url] of Object.entries(lead.socials)) {
        if (url) {
          links.push(`<a href="${escapeHtml(url)}" target="_blank" style="color:#38bdf8; text-transform:capitalize">${net} ↗</a>`);
        }
      }
      if (links.length > 0) socialsHtml = links.join(' &nbsp;|&nbsp; ');
    }

    let techHtml = '<em>No website signals detected.</em>';
    if (lead.techSignals) {
      const parts = [];
      parts.push(`<strong>SSL Status:</strong> ${lead.techSignals.ssl ? '✅ Secure (HTTPS)' : '❌ Missing / HTTP only'}`);
      parts.push(`<strong>CMS / Platform:</strong> ${escapeHtml(lead.techSignals.cms || 'Custom')}`);
      parts.push(`<strong>Ad Pixels:</strong> ${(lead.techSignals.pixels && lead.techSignals.pixels.length > 0) ? lead.techSignals.pixels.join(', ') : 'None detected (Hot Ad Pitch Lead!)'}`);
      parts.push(`<strong>Mobile Optimized:</strong> ${lead.techSignals.mobileOptimized ? 'Yes' : 'No'}`);
      techHtml = parts.join('<br>');
    }

    elements.modalBody.innerHTML = `
      <div class="detail-block">
        <span class="detail-heading">Physical Address & Location</span>
        <div class="detail-content">
          <strong>Full Address:</strong> ${escapeHtml(lead.address?.full || 'Not available')}<br>
          <strong>City / State / ZIP:</strong> ${escapeHtml([lead.address?.city, lead.address?.state, lead.address?.zip].filter(Boolean).join(', ') || '—')}<br>
          <strong>Plus Code:</strong> ${escapeHtml(lead.plusCode || '—')}<br>
          <strong>Coordinates:</strong> ${lead.coordinates?.lat ? `${lead.coordinates.lat}, ${lead.coordinates.lng}` : '—'}
        </div>
      </div>

      <div class="detail-block">
        <span class="detail-heading">Direct Contact & Web</span>
        <div class="detail-content">
          <strong>Phone:</strong> ${escapeHtml(lead.phone?.formatted || lead.phone?.raw || '—')}<br>
          <strong>Website:</strong> ${lead.website ? `<a href="${escapeHtml(lead.website)}" target="_blank" style="color:#38bdf8">${escapeHtml(lead.website)}</a>` : '—'}<br>
          <strong>Extracted Emails:</strong> ${emailsHtml}<br>
          <strong>Social Links:</strong> ${socialsHtml}
        </div>
      </div>

      <div class="detail-block">
        <span class="detail-heading">Tech Stack Signals & Agency Triggers</span>
        <div class="detail-content">${techHtml}</div>
      </div>

      <div class="detail-block">
        <span class="detail-heading">Operating Hours (${escapeHtml(lead.currentStatus || 'Status unknown')})</span>
        <div class="detail-content">${scheduleHtml}</div>
      </div>

      <div class="detail-block">
        <span class="detail-heading">Google Maps Metadata</span>
        <div class="detail-content" style="font-family:var(--font-mono); font-size:10px; word-break:break-all">
          <strong>Place ID:</strong> ${escapeHtml(lead.placeId || '—')}<br>
          <strong>Maps Link:</strong> <a href="${escapeHtml(lead.googleMapsUrl || '#')}" target="_blank" style="color:#818cf8">Open in Google Maps ↗</a>
        </div>
      </div>
    `;

    elements.leadModal.classList.remove('hidden');
  }

  function closeModal() {
    elements.leadModal.classList.add('hidden');
  }

  /**
   * CSV Exporter
   */
  function exportToCsv() {
    const list = state.filteredLeads.length > 0 ? state.filteredLeads : state.leads;
    if (list.length === 0) {
      alert('No leads available to export.');
      return;
    }

    const headers = [
      'Business Name',
      'Claim Status',
      'Primary Category',
      'Rating',
      'Review Count',
      'Phone Raw',
      'Phone E164',
      'Emails',
      'Website',
      'LinkedIn',
      'Facebook',
      'Instagram',
      'Twitter / X',
      'YouTube',
      'TikTok',
      'Full Address',
      'Street',
      'City',
      'State',
      'ZIP',
      'Country',
      'Latitude',
      'Longitude',
      'Place ID',
      'Plus Code',
      'CMS',
      'Ad Pixels',
      'SSL Status',
      'Current Status',
      'Google Maps URL',
      'Scrape Date'
    ];

    const rows = list.map((lead) => [
      lead.name || '',
      lead.claimStatus || '',
      lead.primaryCategory || '',
      lead.rating || '',
      lead.reviewCount || '',
      lead.phone?.raw || '',
      lead.phone?.formatted || '',
      (lead.emails || []).join('; '),
      lead.website || '',
      lead.socials?.linkedin || '',
      lead.socials?.facebook || '',
      lead.socials?.instagram || '',
      lead.socials?.twitter || '',
      lead.socials?.youtube || '',
      lead.socials?.tiktok || '',
      lead.address?.full || '',
      lead.address?.street || '',
      lead.address?.city || '',
      lead.address?.state || '',
      lead.address?.zip || '',
      lead.address?.country || '',
      lead.coordinates?.lat || '',
      lead.coordinates?.lng || '',
      lead.placeId || '',
      lead.plusCode || '',
      lead.techSignals?.cms || '',
      (lead.techSignals?.pixels || []).join('; '),
      lead.techSignals?.ssl ? 'HTTPS' : 'HTTP/None',
      lead.currentStatus || '',
      lead.googleMapsUrl || '',
      lead.scrapeDate || ''
    ]);

    const csvContent = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map((row) => row.map(escapeCsvValue).join(','))
    ].join('\r\n');

    downloadBlob(new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }), `google_maps_leads_${getDateString()}.csv`);
  }

  /**
   * Excel Spreadsheet XML Exporter (.xlsx compatible)
   */
  function exportToExcel() {
    const list = state.filteredLeads.length > 0 ? state.filteredLeads : state.leads;
    if (list.length === 0) {
      alert('No leads available to export.');
      return;
    }

    // Format as clean TSV / Excel XML workbook
    const headers = [
      'Business Name', 'Claim Status', 'Category', 'Rating', 'Reviews',
      'Phone', 'Emails', 'Website', 'LinkedIn', 'Facebook', 'Instagram',
      'Full Address', 'City', 'State', 'ZIP', 'Latitude', 'Longitude',
      'CMS', 'Ad Pixels', 'SSL Status', 'Google Maps URL'
    ];

    let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Leads">
  <Table>
   <Row>`;

    headers.forEach((h) => {
      xml += `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`;
    });
    xml += `</Row>`;

    list.forEach((l) => {
      xml += `<Row>`;
      const fields = [
        l.name, l.claimStatus, l.primaryCategory, l.rating, l.reviewCount,
        l.phone?.formatted || l.phone?.raw, (l.emails || []).join(', '), l.website,
        l.socials?.linkedin, l.socials?.facebook, l.socials?.instagram,
        l.address?.full, l.address?.city, l.address?.state, l.address?.zip,
        l.coordinates?.lat, l.coordinates?.lng,
        l.techSignals?.cms, (l.techSignals?.pixels || []).join(', '),
        l.techSignals?.ssl ? 'HTTPS' : 'HTTP/None', l.googleMapsUrl
      ];

      fields.forEach((val) => {
        const strVal = val != null ? String(val) : '';
        xml += `<Cell><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>`;
      });
      xml += `</Row>`;
    });

    xml += `  </Table>
 </Worksheet>
</Workbook>`;

    downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel' }), `google_maps_leads_${getDateString()}.xls`);
  }

  /**
   * JSON Exporter
   */
  function exportToJson() {
    const list = state.filteredLeads.length > 0 ? state.filteredLeads : state.leads;
    if (list.length === 0) {
      alert('No leads available to export.');
      return;
    }
    const jsonStr = JSON.stringify(list, null, 2);
    downloadBlob(new Blob([jsonStr], { type: 'application/json' }), `google_maps_leads_${getDateString()}.json`);
  }

  function escapeCsvValue(val) {
    if (val == null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function getDateString() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
})();

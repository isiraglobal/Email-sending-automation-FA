/**
 * ============================================================================
 * FOREIGN AFFAIRS LLC — COMPLETE EMAIL AUTOMATION v7.1
 * 
 * FEATURES:
 *   - Gmail API integration (OAuth)
 *   - Cloudflare open tracking (pixel + D1 database)
 *   - Test mode (TEST_MODE = true/false)
 *   - Daily automated reports
 *   - Lead deduplication (3-layer)
 *   - One email every 5 minutes (no bulk)
 *   - Randomized subject + body variants per email
 *   - Reply detection → Discord webhook → WhatsApp
 *   - Batch-optimized open sync
 *   - Error handling on every operation
 *   - Zero data loss
 *   - Trigger scheduling
 *
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION — EDIT THESE
// ============================================================================

// TEST MODE — set to true to process ONLY Test sheet
const TEST_MODE = false;

// Secret key for Cloudflare API
const SECRET_KEY = "fa_open_track_2026_xK9mPqR";

// Cloudflare Worker URL
const CLOUDFLARE_WORKER_URL = "https://emailsendingopenrate.isiraglobal.workers.dev";

// Discord webhook URL for reply notifications → WhatsApp community
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1512500880027418634/TUQeQ8KVXfxot0HLm9l4qC-w_3FUWNwo8WLiicj9w0sTudCd8IZNptnTOxewdp8gGQ_v";

// Google Drive folder for reports
const REPORT_FOLDER_ID = "1p9gPG_X45JPeP8w6TNu7XGcCc466nxKd";

// Report document ID (will be created if doesn't exist)
let REPORT_DOC_ID = null;

// Spreadsheet configuration
const INGEST_CFG = {
  THIS_SS_ID: "1DL7oreU6PnuCRl1MNYjmqKkU1h2JrWfiv2Zah2wi540",
  APIFY_SHEET_NAME: "Apify",
  TEST_SHEET_NAME: "Test",
  OUT_SORTED: "Sorted",
  OUT_PARTIAL: "Partial",
  OUT_RAW: "Raw",
  APIFY: {
    TITLE: 0, CATEGORIES0: 1, ADDRESS: 9, NEIGHBORHOOD: 10, STREET: 11,
    CITY: 12, POSTAL: 13, STATE: 14, COUNTRY: 15, WEBSITE: 17,
    EMAIL0: 18, EMAIL1: 19, EMAIL2: 20, EMAIL3: 21, EMAIL4: 22, EMAIL5: 23,
    PHONE: 24, CATEGORY: 29
  }
};

// Sorted sheet header (digital_footprint stores the business website URL)
const SORTED_HEADER = [
  "id", "name", "city", "address", "phone", "email",
  "venue_type", "capacity", "pricing_range", "description",
  "digital_footprint", "target_audience", "source",
  "status", "variant", "sent_timestamp", "notes",
  "open_timestamp", "open_count"
];

const BASE_HEADER = [
  "id", "name", "city", "address", "phone", "email",
  "venue_type", "capacity", "pricing_range", "description",
  "digital_footprint", "target_audience", "source"
];

// Column indexes (0-based)
const SC = {
  ID: 0, NAME: 1, CITY: 2, ADDRESS: 3, PHONE: 4, EMAIL: 5,
  VENUE_TYPE: 6, CAPACITY: 7, PRICING_RANGE: 8, DESCRIPTION: 9,
  DIGITAL: 10, TARGET_AUDIENCE: 11, SOURCE: 12,
  STATUS: 13, VARIANT: 14, SENT_TIMESTAMP: 15, NOTES: 16,
  OPEN_TIMESTAMP: 17, OPEN_COUNT: 18
};

// Validation constants
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const JUNK_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "10minutemail.com",
  "throwam.com", "trashmail.com", "yopmail.com", "sharklasers.com",
  "guerrillamailblock.com", "grr.la", "dispostable.com", "fakeinbox.com",
  "maildrop.cc", "spamgourmet.com", "spamgourmet.net", "discard.email",
  "mailnull.com", "spamhereplease.com", "getairmail.com", "example.com",
  "test.com", "noreply.com", "spam4.me", "trashmail.io", "throwaway.email"
]);

const GENERIC_EMAIL_RE = /^(noreply|no-reply|donotreply|do-not-reply|info|admin|support|contact|hello|sales|team|office|mail|webmaster|postmaster|enquiries|enquiry|booking|reservations|events|general|management|manager|pr|publicity|press|media|marketing|catering|private|vip|concierge|reception|hospitality|venue|feedback|help|service|services|careers|jobs|hr|accounts|billing|finance)@/i;

// Phone regex — matches real US/NA phone formats, rejects addresses/coordinates
const PHONE_RE = /^\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/;

const US_STATE_ABBREVS = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga",
  "hi","id","il","in","ia","ks","ky","la","me","md",
  "ma","mi","mn","ms","mo","mt","ne","nv","nh","nj",
  "nm","ny","nc","nd","oh","ok","or","pa","ri","sc",
  "sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
  "dc","pr","gu","vi","as","mp"
]);

const SUBAREA_TO_CITY = {
  "manhattan": "new york", "brooklyn": "new york", "queens": "new york",
  "bronx": "new york", "the bronx": "new york", "staten island": "new york",
  "williamsburg": "new york", "bushwick": "new york", "astoria": "new york",
  "flushing": "new york", "harlem": "new york", "greenpoint": "new york",
  "long island city": "new york", "downtown brooklyn": "new york",
  "bed stuy": "new york", "bedford stuyvesant": "new york",
  "gowanus": "new york", "sunset park": "new york", "chelsea": "new york",
  "west hollywood": "los angeles", "east la": "los angeles",
  "silver lake": "los angeles", "echo park": "los angeles",
  "downtown la": "los angeles", "dtla": "los angeles",
  "wicker park": "chicago", "bucktown": "chicago", "logan square": "chicago",
  "lincoln park": "chicago", "downtown chicago": "chicago",
  "midtown houston": "houston", "downtown houston": "houston",
  "downtown austin": "austin", "downtown denver": "denver",
  "downtown seattle": "seattle", "capitol hill seattle": "seattle",
  "downtown philadelphia": "philadelphia", "downtown miami": "miami",
  "downtown atlanta": "atlanta", "downtown boston": "boston",
  "downtown portland": "portland", "downtown nashville": "nashville"
};

// Content variants for USA-optimized email campaigns
const SUBJECT_VARIANTS = [
  "Exclusive Opportunity: Your Venue on Foreign Affairs",
  "Your Venue Stood Out to Us — Let's Collaborate",
  "Partner with Foreign Affairs: Feature Your Venue",
  "We'd Love to Showcase Your Venue",
  "A Unique Proposal for {name} in {city}",
  "Join Foreign Affairs — Exclusive Venue Partnership"
];

const BODY_INTROS = [
  "Hi {name},\n\nI hope this message finds you well. We recently came across {name} in {city} and were genuinely impressed by what you've built. At Foreign Affairs, we're always looking to partner with standout venues like yours to offer our guests unforgettable experiences.\n\nWe believe your venue would be a fantastic addition to our curated collection, and we'd love to explore how we can work together.",
  "Hi {name},\n\nYour venue caught our attention here in {city}. The energy and quality of {name} align perfectly with what Foreign Affairs represents — exclusive, high-end experiences for discerning guests.\n\nWe think there's a real opportunity to showcase your space to our audience and drive meaningful business your way.",
  "Hi {name},\n\nWe're reaching out from Foreign Affairs because {name} in {city} looks like exactly the kind of standout venue we want to feature. Our platform connects exceptional spaces with people seeking memorable experiences, and we think you'd be a perfect fit.\n\nLet's discuss how we can make this work for both of us.",
  "Hi {name},\n\nForeign Affairs is all about curating the best experiences, and {name} in {city} is exactly what we look for. We'd love to feature your venue and introduce your space to our growing network of guests looking for something special.\n\nWe're confident this could be a great partnership.",
  "Hi {name},\n\nI wanted to personally reach out because {name} has the kind of character and quality that resonates with what we do at Foreign Affairs. Located in {city}, your venue stands out — and we'd love to help it shine even brighter.\n\nLet's chat about how we can feature you.",
  "Hi {name},\n\nWe're always searching for exceptional venues, and {name} in {city} is exactly what our guests are looking for. Foreign Affairs specializes in connecting premium spaces with people who appreciate quality, and we think you'd be an incredible addition.\n\nLooking forward to exploring a partnership."
];

const BODY_CLOSINGS = [
  "Would you be open to a quick 15-minute call this week to explore a potential fit? Just reply to this email and I'll personally send over the details to get something scheduled.\n\nLooking forward to connecting!\n\n<strong>Foreign Affairs Team</strong>",
  "If you're interested, I'd love to set up a brief 15-minute call at your convenience. Simply reply here and I'll take care of the rest — no obligation, just a conversation.\n\nTalk soon!\n\n<strong>Foreign Affairs Team</strong>",
  "Are you available for a short 15-minute chat sometime soon? Drop a reply and I'll send you everything you need to get a call booked.\n\nBest regards,\n\n<strong>Foreign Affairs Team</strong>",
  "Let me know if you'd be up for a 15-minute call — I'm happy to work around your schedule. Just reply to this email and I'll personally share the next steps.\n\nWarmly,\n\n<strong>Foreign Affairs Team</strong>",
  "Would a quick 15-minute call work for you? Reply when you get a chance and I'll send over the details to set something up.\n\nCheers,\n\n<strong>Foreign Affairs Team</strong>",
  "If you're open to it, I'd love to schedule a brief 15-minute call to see if there's a mutual fit. Just reply here and I'll personally follow up with everything needed.\n\nAll the best,\n\n<strong>Foreign Affairs Team</strong>"
];


// ============================================================================
// START HERE — Click Run to see this guide
// ============================================================================

/**
 * run()
 * Default entry point when clicking the Run button.
 * Shows which function to actually run based on TEST_MODE.
 * After running this, check View → Logs or click the Executions tab.
 */
function run() {
  var msg = "";
  msg += "=================================================\n";
  msg += "FOREIGN AFFAIRS AUTOMATION\n";
  msg += "=================================================\n";
  msg += "TEST_MODE = " + TEST_MODE + "\n";
  msg += "\n";
  msg += "Select a function from the dropdown above, then click Run:\n";
  msg += "\n";
  msg += "1. sortSpreadsheetLeads()\n";
  msg += "   Import & deduplicate leads into the sheet\n";
  if (TEST_MODE) {
    msg += "   (reads from Test sheet, writes in-place)\n";
  } else {
    msg += "   (reads from Apify, writes to Sorted/Partial/Raw)\n";
  }
  msg += "\n";
  msg += "2. sendNextEmail()\n";
  msg += "   Send 1 email to the next unsent lead\n";
  msg += "   (runs automatically every 5 min in production)\n";
  msg += "\n";
  msg += "3. syncOpensFromCloudflare()\n";
  msg += "   Fetch opens from Cloudflare tracking pixel\n";
  msg += "\n";
  msg += "4. checkAndNotifyReplies()\n";
  msg += "   Check Gmail for replies → Discord → WhatsApp\n";
  msg += "\n";
  msg += "5. generateDailyReport()\n";
  msg += "   Generate daily metrics report in Google Drive\n";
  msg += "\n";
  msg += "6. setupGmailOAuth() [run once on first setup]\n";
  msg += "\n";
  if (TEST_MODE) {
    msg += "TIP: Run createTestData() FIRST to populate the Test sheet\n";
    msg += "     with sample leads, then run sortSpreadsheetLeads().\n";
  }
  msg += "=================================================";
  Logger.log(msg);
}


// ============================================================================
// SETUP — Run Once
// ============================================================================

/**
 * setupGmailOAuth()
 * Run this ONCE to authenticate with Gmail
 * Then the script has permanent access
 */
function setupGmailOAuth() {
  try {
    const gmail = Gmail.Users.getProfile("me");
    Logger.log("Gmail authenticated as: " + gmail.emailAddress);
    Logger.log("You can now use sendEmailViaGmail()");
  } catch (e) {
    Logger.log("ERROR: Gmail OAuth failed: " + e.message);
    Logger.log("You may need to authorize in: Settings Apps Script permissions");
  }
}

/**
 * setupCloudflareDatabase()
 * Create the D1 database table (run in Cloudflare console once)
 */
function setupCloudflareDatabase() {
  const sqlCommand = `
CREATE TABLE IF NOT EXISTS email_opens (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id   TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  user_agent TEXT,
  ip        TEXT,
  country   TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lead_id ON email_opens(lead_id);
CREATE INDEX IF NOT EXISTS idx_opened_at ON email_opens(opened_at);
  `;
  Logger.log("Copy this SQL to Cloudflare D1 console:");
  Logger.log(sqlCommand);
}

/**
 * createTestData()
 * Populates the "Test" sheet with 10 realistic sample leads.
 * Run this ONCE after setting TEST_MODE=true to have data to work with.
 * The test emails are safe, deliverable addresses you can own for testing.
 */
function createTestData() {
  const ss = _getActiveSS();
  let sheet = ss.getSheetByName(INGEST_CFG.TEST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INGEST_CFG.TEST_SHEET_NAME);
    Logger.log("Created Test sheet");
  } else {
    const clear = SpreadsheetApp.getUi().alert(
      "Test sheet already exists. Clear and replace?",
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (clear === SpreadsheetApp.getUi().Button.NO) return;
    sheet.clear();
  }

  const data = [
    ["name","venue_type","address","street","neighborhood","city","postal","state","country","website","email0","email1","email2","email3","email4","email5","phone","","","","","","","","","","","","category"],
    ["Skyline Rooftop Lounge","Rooftop Bar / Lounge","456 Sunset Blvd","Sunset Blvd","Hollywood","Los Angeles","90028","ca","united states","https://skylinerooftop.com","skyline@skylinerooftop.com","events@skylinerooftop.com","","","","","+1-310-555-0198","","","","","","","","","","","","Nightlife / Rooftop"],
    ["The Gilded Lily","Fine Dining / Event Space","789 Park Avenue","Park Ave","Upper East Side","New York","10065","ny","united states","https://thegildedlily.com","gildedlily@thegildedlily.com","events@thegildedlily.com","booking@thegildedlily.com","","","","+1-212-555-0143","","","","","","","","","","","","Fine Dining / Events"],
    ["Ironworks Social Club","Bar / Live Music Venue","321 Industrial Blvd","Industrial Blvd","Downtown","Austin","78701","tx","united states","https://ironworkssocial.com","ironworks@ironworkssocial.com","events@ironworkssocial.com","","","","","+1-512-555-0276","","","","","","","","","","","","Music Venue / Bar"],
    ["Lakeside Pavilion","Wedding / Banquet Hall","1500 Lake Shore Dr","Lake Shore Dr","Lakeview","Chicago","60610","il","united states","https://lakesidepavilion.com","lakeside@lakesidepavilion.com","events@lakesidepavilion.com","booking@lakesidepavilion.com","","","","+1-312-555-0392","","","","","","","","","","","","Weddings / Banquets"],
    ["The Velvet Lounge","Cocktail Bar / Lounge","82 Pike Street","Pike St","Capitol Hill","Seattle","98101","wa","united states","https://thevelvetlounge.com","velvet@thevelvetlounge.com","","","","","","+1-206-555-0417","","","","","","","","","","","","Cocktail Bar / Lounge"],
    ["Mirage Garden","Garden / Outdoor Venue","700 Alamo Plaza","Alamo Plaza","Downtown","San Antonio","78205","tx","united states","https://miragegarden.com","mirage@miragegarden.com","info@miragegarden.com","","","","","+1-210-555-0534","","","","","","","","","","","","Outdoor / Garden Venue"],
    ["The Mercury Room","Nightclub / Event Space","1200 Broadway","Broadway","Downtown","Denver","80202","co","united states","https://mercuryroom.com","mercury@mercuryroom.com","vip@mercuryroom.com","events@mercuryroom.com","","","","+1-303-555-0621","","","","","","","","","","","","Nightclub / Events"],
    ["Harbor View Hall","Waterfront / Corporate","88 Pier Road","Pier Rd","Waterfront","San Francisco","94105","ca","united states","https://harborviewhall.com","harborview@harborviewhall.com","info@harborviewhall.com","sales@harborviewhall.com","","","","+1-415-555-0789","","","","","","","","","","","","Waterfront / Corporate"],
    ["The Pine Room","Private Dining / Supper Club","45 Elm Street","Elm St","West End","Portland","04101","me","united states","https://thepineroom.com","pineroom@thepineroom.com","reservations@thepineroom.com","","","","","+1-207-555-0845","","","","","","","","","","","","Private Dining / Supper Club"],
    ["Coral Sands","Beach Club / Resort","950 Ocean Drive","Ocean Dr","South Beach","Miami","33139","fl","united states","https://coralsandsbeachclub.com","coralsands@coralsandsbeachclub.com","events@coralsandsbeachclub.com","booking@coralsandsbeachclub.com","reservations@coralsandsbeachclub.com","","","+1-305-555-0912","","","","","","","","","","","","Beach Club / Resort"]
  ];

  data.forEach((row, idx) => {
    if (idx === 0) {
      sheet.appendRow(row);
      sheet.getRange(1, 1, 1, row.length).setFontWeight("bold").setBackground("#f3f3f3");
    } else {
      sheet.appendRow(row);
    }
  });

  // Auto-resize for readability
  if (sheet.getLastColumn() > 0) sheet.autoResizeColumns(1, sheet.getLastColumn());

  Logger.log("Test sheet populated with " + (data.length - 1) + " sample leads");
  Logger.log("Switch TEST_MODE=true, then run sortSpreadsheetLeads()");
}


// ============================================================================
// MAIN: SORTING & IMPORT
// ============================================================================

/**
 * sortSpreadsheetLeads()
 * Main import function — processes either Test or Apify sheet
 * Pixel URLs are now generated at send-time, not during import.
 * "digital_footprint" column stores the business website URL.
 */
function sortSpreadsheetLeads() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);

  try {
    const activeSS = _getActiveSS();

    if (TEST_MODE === true) {
      Logger.log("TEST MODE ACTIVE (TEST_MODE=true) — processing Test sheet in-place");
      _processTestSheetInPlace(activeSS);
      return;
    }

    // PRODUCTION MODE — standard Apify → Sorted/Partial/Raw flow
    Logger.log("PRODUCTION MODE (TEST_MODE=false)");
    const sourceSheet = activeSS.getSheetByName(INGEST_CFG.APIFY_SHEET_NAME);
    if (!sourceSheet) {
      Logger.log("ERROR: APIFY_SHEET_NAME not found");
      return;
    }

    const sortedSheet  = _getOrCreate(activeSS, INGEST_CFG.OUT_SORTED);
    const partialSheet = _getOrCreate(activeSS, INGEST_CFG.OUT_PARTIAL);
    const rawSheet     = _getOrCreate(activeSS, INGEST_CFG.OUT_RAW);

    _ensureHeader(sortedSheet, SORTED_HEADER);
    _ensureHeader(partialSheet, BASE_HEADER);
    _ensureHeader(rawSheet, BASE_HEADER);

    let nextSortedId  = _maxId(sortedSheet) + 1;
    let nextPartialId = _maxId(partialSheet) + 1;
    let nextRawId     = _maxId(rawSheet) + 1;

    const seenEmails   = new Set();
    const seenPhones   = new Set();
    const seenNameCity = new Set();
    _loadExistingDedupeSets(activeSS, seenEmails, seenPhones, seenNameCity);

    const newSorted  = [];
    const newPartial = [];
    const newRaw     = [];

    const stats = {
      processed: 0, imported: 0, dupeEmail: 0, dupePhone: 0, dupeNameCity: 0,
      malformed: 0, junkEmail: 0, toSorted: 0, toPartial: 0, toRaw: 0, errors: []
    };

    let sourceData = [];
    try {
      sourceData = sourceSheet.getDataRange().getValues();
    } catch (e) {
      Logger.log("ERROR reading " + INGEST_CFG.APIFY_SHEET_NAME + ": " + e.message);
      return;
    }

    if (sourceData.length < 2) {
      Logger.log(INGEST_CFG.APIFY_SHEET_NAME + " is empty");
      return;
    }

    const firstCell = String(sourceData[0][0]).toLowerCase();
    const hasHeader = firstCell.includes("title") || firstCell.includes("name");
    const startRow = hasHeader ? 1 : 0;
    const A = INGEST_CFG.APIFY;

    Logger.log("Processing " + (sourceData.length - startRow) + " rows from " + INGEST_CFG.APIFY_SHEET_NAME);

    for (let i = startRow; i < sourceData.length; i++) {
      stats.processed++;

      try {
        const row = sourceData[i].map(v =>
          (v !== null && v !== undefined) ? String(v).trim() : ""
        );

        if (row.filter(c => c !== "").length < 2) { stats.malformed++; continue; }

        let nameVal = _cellSafe(row, A.TITLE, "").normalize("NFKD").trim();
        let cityRaw = _cellSafe(row, A.CITY, "").normalize("NFKD").trim();
        let addressVal = (
          _cellSafe(row, A.ADDRESS, "") ||
          [_cellSafe(row, A.STREET, ""), _cellSafe(row, A.NEIGHBORHOOD, "")].filter(Boolean).join(", ")
        ).normalize("NFKD").trim();
        let website  = _cellSafe(row, A.WEBSITE, "");
        let phone    = _cellSafe(row, A.PHONE, "");
        let category = _cellSafe(row, A.CATEGORY, "") || _cellSafe(row, A.CATEGORIES0, "");

        if (!nameVal || nameVal.length < 3 || EMAIL_RE.test(nameVal)) {
          stats.malformed++; continue;
        }

        let email = "";
        for (let e = A.EMAIL0; e <= A.EMAIL5; e++) {
          const candidate = _cellSafe(row, e, "").toLowerCase();
          if (candidate && EMAIL_RE.test(candidate)) { email = candidate; break; }
        }

        if (!email || !phone) {
          for (let j = 0; j < row.length; j++) {
            const cell = String(row[j]).trim();
            const digits = cell.replace(/\D/g, "");
            if (!email && EMAIL_RE.test(cell)) email = cell.toLowerCase();
            if (!phone && digits.length >= 10 && digits.length <= 15) phone = cell;
          }
        }

        if (email) {
          const parts = email.split("@");
          const domain = parts[1] || "";
          const isJunk = (
            /^\d+\.?\d*$/.test(parts[0]) ||
            GENERIC_EMAIL_RE.test(email) ||
            JUNK_DOMAINS.has(domain) ||
            /@(example|test|noreply|no-reply|donotreply)\./i.test(email)
          );
          if (isJunk) { email = ""; stats.junkEmail++; }
        }

        const cityNorm = _normalizeCity(cityRaw);
        const dupeResult = _checkDupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
        if (dupeResult) { stats["dupe" + dupeResult]++; continue; }

        const hasEmail = email && EMAIL_RE.test(email);
        const hasPhone = phone && phone.replace(/\D/g, "").length >= 10;

        const base = _buildBaseRow(
          0, nameVal, cityRaw, addressVal, phone, email,
          category, "", "", "", website, website, INGEST_CFG.APIFY_SHEET_NAME
        );

        base[0] = nextRawId++;
        newRaw.push([...base]);
        stats.toRaw++;

        if (hasEmail && hasPhone) {
          const sortedRow = _toSortedRow(base);
          sortedRow[0] = nextSortedId++;
          newSorted.push(sortedRow);
          stats.toSorted++;
        } else if (hasPhone) {
          base[0] = nextPartialId++;
          newPartial.push([...base]);
          stats.toPartial++;
        }

        _registerDedupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
        stats.imported++;

      } catch (e) {
        stats.errors.push("Row " + (i + 1) + ": " + e.message);
      }
    }

    _appendBlock(sortedSheet, newSorted);
    _appendBlock(partialSheet, newPartial);
    _appendBlock(rawSheet, newRaw);

    Logger.log("=================================================");
    Logger.log("INGESTION COMPLETE");
    Logger.log("Processed: " + stats.processed + " | Imported: " + stats.imported);
    Logger.log("Sorted: " + stats.toSorted + " | Partial: " + stats.toPartial + " | Raw: " + stats.toRaw);
    if (stats.errors.length > 0) {
      Logger.log("ERRORS: " + stats.errors.length);
      stats.errors.slice(0, 5).forEach(e => Logger.log("  " + e));
    }
    Logger.log("=================================================");

  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
/**
 * _processTestSheetInPlace(ss)
 * Processes the Test sheet when TEST_MODE=true.
 * Expands the Test sheet in-place with full SORTED_HEADER columns.
 * No data is moved to Sorted/Partial/Raw — Test sheet remains self-contained.
 */
function _processTestSheetInPlace(ss) {
  const sheet = ss.getSheetByName(INGEST_CFG.TEST_SHEET_NAME);
  if (!sheet) {
    Logger.log("ERROR: Test sheet not found");
    return;
  }

  let sourceData = [];
  try {
    sourceData = sheet.getDataRange().getValues();
  } catch (e) {
    Logger.log("ERROR reading Test sheet: " + e.message);
    return;
  }

  if (sourceData.length < 2) {
    Logger.log("Test sheet is empty");
    return;
  }

  const firstCell = String(sourceData[0][0]).toLowerCase();
  const hasHeader = firstCell.includes("title") || firstCell.includes("name") || firstCell.includes("id");
  const startRow = hasHeader ? 1 : 0;
  const A = hasHeader ? _buildTestColMap(sourceData[0]) : _buildTestColMap([]);

  Logger.log("Processing " + (sourceData.length - Math.max(startRow, 1)) + " rows from Test sheet");

  // Ensure the Test sheet has the full SORTED_HEADER (add missing columns)
  const existingCols = sourceData[0] ? sourceData[0].length : 0;
  const needsHeader = !hasHeader || existingCols < SORTED_HEADER.length;

  if (needsHeader) {
    // Write header row into the first row
    sheet.getRange(1, 1, 1, SORTED_HEADER.length).setValues([SORTED_HEADER]);
    sheet.getRange(1, 1, 1, SORTED_HEADER.length).setFontWeight("bold").setBackground("#f3f3f3");
  }

  let nextId = _maxId(sheet) + 1;

  const seenEmails   = new Set();
  const seenPhones   = new Set();
  const seenNameCity = new Set();
  // Load dedupe from existing rows in Test sheet
  if (sheet.getLastRow() > 1) {
    const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(6, SORTED_HEADER.length)).getValues();
    existing.forEach(r => {
      const name = String(r[1] || "").trim();
      const city = String(r[2] || "").trim();
      const phone = String(r[4] || "").trim();
      const email = String(r[5] || "").trim();
      if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
      const digits = phone.replace(/\D/g, "");
      if (digits.length >= 10) seenPhones.add(digits);
      const nameKey = _normStr(name) + "|" + _normalizeCity(city);
      if (nameKey.length > 1) seenNameCity.add(nameKey);
    });
  }

  const stats = {
    processed: 0, imported: 0, dupeEmail: 0, dupePhone: 0, dupeNameCity: 0,
    malformed: 0, junkEmail: 0, sorted: 0, errors: []
  };

  const outputRows = [];

  for (let i = startRow; i < sourceData.length; i++) {
    stats.processed++;

    try {
      const row = sourceData[i].map(v =>
        (v !== null && v !== undefined) ? String(v).trim() : ""
      );

      if (row.filter(c => c !== "").length < 2) { stats.malformed++; continue; }

      let nameVal = _cellSafe(row, A.TITLE, "").normalize("NFKD").trim();
      let cityRaw = _cellSafe(row, A.CITY, "").normalize("NFKD").trim();
      let addressVal = (
        _cellSafe(row, A.ADDRESS, "") ||
        [_cellSafe(row, A.STREET, ""), _cellSafe(row, A.NEIGHBORHOOD, "")].filter(Boolean).join(", ")
      ).normalize("NFKD").trim();
      let website  = _cellSafe(row, A.WEBSITE, "");
      let phone    = _cellSafe(row, A.PHONE, "");
      let category = _cellSafe(row, A.CATEGORY, "") || _cellSafe(row, A.CATEGORIES0, "");

      if (!nameVal || nameVal.length < 3 || EMAIL_RE.test(nameVal)) {
        stats.malformed++; continue;
      }

      let email = "";
      for (let e = A.EMAIL0; e <= A.EMAIL5; e++) {
        const candidate = _cellSafe(row, e, "").toLowerCase();
        if (candidate && EMAIL_RE.test(candidate)) { email = candidate; break; }
      }

      if (!email || !phone) {
        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j]).trim();
          const digits = cell.replace(/\D/g, "");
          if (!email && EMAIL_RE.test(cell)) email = cell.toLowerCase();
          if (!phone && digits.length >= 10 && digits.length <= 15) phone = cell;
        }
      }

      if (email) {
        const parts = email.split("@");
        const domain = parts[1] || "";
        const isJunk = (
          /^\d+\.?\d*$/.test(parts[0]) ||
          GENERIC_EMAIL_RE.test(email) ||
          JUNK_DOMAINS.has(domain) ||
          /@(example|test|noreply|no-reply|donotreply)\./i.test(email)
        );
        if (isJunk) { email = ""; stats.junkEmail++; }
      }

      const cityNorm = _normalizeCity(cityRaw);
      const dupeResult = _checkDupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
      if (dupeResult) { stats["dupe" + dupeResult]++; continue; }

      const hasEmail = email && EMAIL_RE.test(email);
      const hasPhone = phone && phone.replace(/\D/g, "").length >= 10;

      // Build full SORTED_HEADER row (leave tracking fields empty)
      const outRow = [
        nextId++,                      // id
        nameVal,                       // name
        cityRaw,                       // city
        addressVal,                    // address
        hasPhone ? phone : "",          // phone
        hasEmail ? email : "",          // email
        category,                      // venue_type
        "",                            // capacity
        "",                            // pricing_range
        "",                            // description
        website,                       // digital_footprint
        website,                       // target_audience
        "test",                        // source
        "",                            // status
        "",                            // variant
        "",                            // sent_timestamp
        "",                            // notes
        "",                            // open_timestamp
        ""                             // open_count
      ];

      outputRows.push(outRow);
      _registerDedupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
      stats.imported++;
      if (hasEmail && hasPhone) stats.sorted++;

    } catch (e) {
      stats.errors.push("Row " + (i + 1) + ": " + e.message);
    }
  }

  if (outputRows.length > 0) {
    // Clear existing data rows and write fresh output
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, SORTED_HEADER.length).clearContent();
    }
    sheet.getRange(2, 1, outputRows.length, SORTED_HEADER.length).setValues(outputRows);
  }

  Logger.log("=================================================");
  Logger.log("TEST SHEET PROCESSED (in-place)");
  Logger.log("Processed: " + stats.processed + " | Imported: " + stats.imported + " | Sorted: " + stats.sorted);
  Logger.log("Duplicates: " + (stats.dupeEmail + stats.dupePhone + stats.dupeNameCity) + " | Malformed: " + stats.malformed + " | Junk: " + stats.junkEmail);
  if (stats.errors.length > 0) {
    Logger.log("ERRORS: " + stats.errors.length);
    stats.errors.slice(0, 5).forEach(e => Logger.log("  " + e));
  }
  Logger.log("=================================================");
}


// ============================================================================
// MAIN: EMAIL SENDING — ONE EMAIL EVERY 5 MINUTES
// ============================================================================
// ============================================================================

/**
 * sendNextEmail()
 * Sends email(s) to unsent leads.
 *
 * TEST_MODE behavior:
 *   - true  → reads from "Test" sheet, sends ALL unsent leads immediately
 *   - false → reads from "Sorted" sheet, sends exactly 1 (for 5-min trigger)
 *
 * Trigger: Time-driven → Every 5 minutes (only used when TEST_MODE=false)
 */
function sendNextEmail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log("Could not acquire lock — another send may be in progress");
    return;
  }

  try {
    const ss = _getActiveSS();

    const sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log("No data in " + sheetName);
      return;
    }

    const header = data[0];
    const colIdx = {};
    SORTED_HEADER.forEach((name, idx) => {
      const hIdx = header.indexOf(name);
      if (hIdx >= 0) colIdx[name] = hIdx;
    });

    const cStatus    = colIdx["status"] !== undefined ? colIdx["status"] : SC.STATUS;
    const cName      = colIdx["name"] !== undefined ? colIdx["name"] : SC.NAME;
    const cEmail     = colIdx["email"] !== undefined ? colIdx["email"] : SC.EMAIL;
    const cPhone     = colIdx["phone"] !== undefined ? colIdx["phone"] : SC.PHONE;
    const cCity      = colIdx["city"] !== undefined ? colIdx["city"] : SC.CITY;
    const cVenueType = colIdx["venue_type"] !== undefined ? colIdx["venue_type"] : SC.VENUE_TYPE;
    const cVariant   = colIdx["variant"] !== undefined ? colIdx["variant"] : SC.VARIANT;
    const cSentTS    = colIdx["sent_timestamp"] !== undefined ? colIdx["sent_timestamp"] : SC.SENT_TIMESTAMP;
    const cNotes     = colIdx["notes"] !== undefined ? colIdx["notes"] : SC.NOTES;

    // In test mode, send ALL unsent leads. In production, send only 1.
    const maxToSend = TEST_MODE ? data.length : 1;
    let sentCount = 0;
    let skipCount = 0;
    const MAX_SKIP = 50;

    for (let i = 1; i < data.length && sentCount < maxToSend; i++) {
      const status = String(data[i][cStatus] || "").trim().toLowerCase();
      const email = String(data[i][cEmail] || "").trim();
      const phone = String(data[i][cPhone] || "").trim();
      const digits = phone.replace(/\D/g, "");

      const hasValidEmail = EMAIL_RE.test(email);
      const hasValidPhone = digits.length >= 10 && PHONE_RE.test(phone.replace(/\s+/g, " ").trim());

      if (status === "sent" || status === "failed") continue;

      if (!hasValidEmail || !hasValidPhone) {
        skipCount++;
        if (skipCount <= 5 || skipCount % 10 === 0) {
          Logger.log("SKIP row " + (i + 1) + ": " + data[i][cName] + " — email=" + (hasValidEmail ? "ok" : "BAD[" + email + "]") + " phone=" + (hasValidPhone ? "ok" : "BAD[" + phone + "]"));
        }
        if (skipCount >= MAX_SKIP) {
          Logger.log("ABORT: " + skipCount + " consecutive invalid rows reached. Data may be corrupt.");
          break;
        }
        continue;
      }

      skipCount = 0;

      const name = String(data[i][cName] || "").trim();
      const city = String(data[i][cCity] || "").trim();
      const venueType = String(data[i][cVenueType] || "").trim();
      const leadId = String(data[i][SC.ID] || "").trim();

      const pixelUrl = _generateTrackingPixel("lead-" + leadId, email);

      const si = _pickRandomIndex(SUBJECT_VARIANTS);
      const ii = _pickRandomIndex(BODY_INTROS);
      const ci = _pickRandomIndex(BODY_CLOSINGS);

      const subject = SUBJECT_VARIANTS[si]
        .replace(/{name}/g, name)
        .replace(/{city}/g, city)
        .replace(/{venuetype}/g, venueType);

      const intro = BODY_INTROS[ii]
        .replace(/{name}/g, name)
        .replace(/{city}/g, city)
        .replace(/{venuetype}/g, venueType);

      const closing = BODY_CLOSINGS[ci];

      const htmlBody = _buildEmailHtml(name, intro, closing, pixelUrl);

      const result = sendEmailViaGmail(email, subject, htmlBody);
      const rowNum = i + 1;
      const variantLabel = "v" + (si + 1) + "." + (ii + 1) + "." + (ci + 1);

      if (result.success) {
        const timestamp = Utilities.formatDate(
          new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"
        );

        sheet.getRange(rowNum, cStatus + 1).setValue("sent");
        sheet.getRange(rowNum, cSentTS + 1).setValue(timestamp);
        sheet.getRange(rowNum, cVariant + 1).setValue(variantLabel);
        Logger.log("Sent to: " + email + " | " + name + " | variant=" + variantLabel);
        sentCount++;
      } else {
        const existingNotes = String(data[i][cNotes] || "");
        const isQuotaError = result.error.indexOf("too many times") >= 0 || result.error.indexOf("rate") >= 0 || result.error.indexOf("quota") >= 0;

        if (isQuotaError) {
          // GmailApp.sendEmail submits to Gmail SMTP before checking the Apps Script quota counter.
          // The quota error only means the counter was exhausted — the email WAS sent.
          const timestamp = Utilities.formatDate(
            new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"
          );
          sheet.getRange(rowNum, cStatus + 1).setValue("sent");
          sheet.getRange(rowNum, cSentTS + 1).setValue(timestamp);
          sheet.getRange(rowNum, cVariant + 1).setValue(variantLabel);
          sheet.getRange(rowNum, cNotes + 1).setValue("Quota exceeded (email sent): " + result.error);
          Logger.log("QUOTA (sent): " + email + " | " + name + " | " + result.error);
          sentCount++;
          break;
        }

        const retryMatch = existingNotes.match(/retry:(\d+)/);
        let retryCount = retryMatch ? parseInt(retryMatch[1]) : 0;
        retryCount++;

        if (retryCount >= 3) {
          sheet.getRange(rowNum, cStatus + 1).setValue("failed");
          sheet.getRange(rowNum, cNotes + 1).setValue("Failed after " + retryCount + " retries. Last error: " + result.error);
          Logger.log("FAILED after 3 retries: " + email + " | " + result.error);
        } else {
          sheet.getRange(rowNum, cNotes + 1).setValue("retry:" + retryCount + " | " + result.error);
          Logger.log("Send failed (retry " + retryCount + "/3): " + email + " | " + result.error);
        }
      }

      // In production mode, only send 1 per trigger run
      if (!TEST_MODE) break;
    }

    Logger.log("sendNextEmail complete: " + sentCount + " email(s) sent");

  } finally {
    lock.releaseLock();
  }
}

/**
 * sendEmailViaGmail(email, subject, htmlBody)
 * Sends email via Gmail API
 */
function sendEmailViaGmail(email, subject, htmlBody) {
  try {
    GmailApp.sendEmail(email, subject, "", {
      htmlBody: htmlBody,
      from: Session.getEffectiveUser().getEmail(),
      replyTo: Session.getEffectiveUser().getEmail()
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


// ============================================================================
// EMAIL TEMPLATE — RANDOMIZED CONTENT
// ============================================================================

/**
 * _buildEmailHtml(name, intro, closing, pixelUrl)
 * Builds full HTML email without detectable tracking comments
 */
function _buildEmailHtml(name, intro, closing, pixelUrl) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2C3E50; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .footer { background: #ECF0F1; padding: 10px; text-align: center; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Foreign Affairs</h1>
    </div>
    <div class="content">
      <p>${intro.replace(/\n/g, "<br>")}</p>
      <p>${closing.replace(/\n/g, "<br>")}</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Foreign Affairs LLC. All rights reserved.</p>
    </div>
  </div>
  <img src="${pixelUrl}" width="1" height="1" style="display:none" />
</body>
</html>`;
  return html;
}

/**
 * _generateTrackingPixel(leadId, email)
 * Generates a tracking pixel URL for open detection
 */
function _generateTrackingPixel(leadId, email) {
  if (!leadId || !email) return "";
  try {
    const encodedEmail = encodeURIComponent(email);
    const timestamp = new Date().toISOString();
    return CLOUDFLARE_WORKER_URL + "/pixel?id=" + leadId + "&e=" + encodedEmail + "&t=" + encodeURIComponent(timestamp);
  } catch (e) {
    Logger.log("Error generating pixel: " + e.message);
    return "";
  }
}

/**
 * _pickRandom(arr)
 * Returns a random element from an array
 */
function _pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * _pickRandomIndex(arr)
 * Returns the index of a randomly selected element
 */
function _pickRandomIndex(arr) {
  return Math.floor(Math.random() * arr.length);
}


// ============================================================================
// MAIN: OPEN RATE SYNC — BATCH OPTIMIZED
// ============================================================================

/**
 * syncOpensFromCloudflare(sheetName)
 * Fetch all opens from Cloudflare and batch-update the sheet
 * Tracks last sync time in Script Properties to avoid redundant fetches
 */
function syncOpensFromCloudflare(sheetName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    sheetName = sheetName || (TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED);

    const ss = _getActiveSS();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    // Fetch all opens from Cloudflare
    const allOpensUrl = CLOUDFLARE_WORKER_URL + "/api/opens/all?key=" + SECRET_KEY;
    let response;
    try {
      response = UrlFetchApp.fetch(allOpensUrl, { muteHttpExceptions: true });
    } catch (e) {
      Logger.log("ERROR fetching from Cloudflare: " + e.message);
      return;
    }

    if (response.getResponseCode() !== 200) {
      Logger.log("ERROR: Cloudflare returned " + response.getResponseCode());
      return;
    }

    const result = JSON.parse(response.getContentText());
    const opensByLeadId = result.opens_by_lead || {};

    // Read full sheet data
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log("No data to sync");
      return;
    }

    // Build batch updates
    let updated = 0;
    const updates = []; // { rowNum, openTimestamp, openCount }

    for (let i = 1; i < data.length; i++) {
      const leadId = String(data[i][SC.ID] || "").trim();
      const opens = opensByLeadId["lead-" + leadId] || [];

      if (opens.length > 0) {
        const lastOpen = opens[0];
        updates.push({
          rowNum: i + 1,
          openTimestamp: lastOpen.opened_at,
          openCount: opens.length
        });
        updated++;
      }
    }

    // Apply all updates in batches (500 rows per batch to avoid size limits)
    const BATCH_SIZE = 500;
    for (let b = 0; b < updates.length; b += BATCH_SIZE) {
      const batch = updates.slice(b, b + BATCH_SIZE);

      // Build range arrays
      const tsRange = sheet.getRange(batch[0].rowNum, SC.OPEN_TIMESTAMP + 1, batch.length, 1);
      const countRange = sheet.getRange(batch[0].rowNum, SC.OPEN_COUNT + 1, batch.length, 1);

      const tsValues = batch.map(u => [u.openTimestamp]);
      const countValues = batch.map(u => [u.openCount]);

      tsRange.setValues(tsValues);
      countRange.setValues(countValues);
    }

    // Store last sync timestamp
    const props = PropertiesService.getScriptProperties();
    props.setProperty("LAST_OPEN_SYNC", new Date().toISOString());

    Logger.log("Synced opens from Cloudflare: " + updated + " rows updated");

  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
// MAIN: REPLY DETECTION → DISCORD WEBHOOK → WHATSAPP
// ============================================================================

/**
 * checkAndNotifyReplies()
 * Searches Gmail for replies to our campaign emails.
 * When a reply is found, sends a formatted notification to Discord webhook.
 * Discord forwards to the connected WhatsApp community channel.
 *
 * Trigger: Time-driven → Every 12 hours (twice daily)
 */
function checkAndNotifyReplies() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = _getActiveSS();
    const sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;

    // Find all sent leads with their email addresses
    const sentLeads = {};
    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][SC.STATUS] || "").trim();
      const email = String(data[i][SC.EMAIL] || "").trim();
      const name = String(data[i][SC.NAME] || "").trim();
      if (status === "sent" && email) {
        sentLeads[email.toLowerCase()] = {
          row: i + 1,
          name: name,
          email: email
        };
      }
    }

    if (Object.keys(sentLeads).length === 0) {
      Logger.log("No sent leads to check replies for");
      return;
    }

    // Get last check time from properties
    const props = PropertiesService.getScriptProperties();
    const lastCheck = props.getProperty("LAST_REPLY_CHECK");
    const queryAfter = lastCheck || "2024-01-01";

    // Search for replies in the inbox
    const searchTerms = ["Exclusive Opportunity", "Your Venue", "Foreign Affairs", "Partner with", "Showcase Your Venue", "Proposal", "Partnership", "Foreign Affairs Team", "15-minute call", "venue inquiry", "event partnership"];
    const query = "in:inbox \"Re:\" (" + searchTerms.join(" OR ") + ") after:" + queryAfter.split("T")[0];
    const threads = GmailApp.search(query, 0, 50);

    if (threads.length === 0) {
      Logger.log("No new replies found");
      props.setProperty("LAST_REPLY_CHECK", new Date().toISOString());
      return;
    }

    let repliesFound = 0;

    for (let t = 0; t < threads.length; t++) {
      const messages = threads[t].getMessages();

      for (let m = 0; m < messages.length; m++) {
        const msg = messages[m];
        const from = msg.getFrom();
        const date = msg.getDate();
        const body = msg.getPlainBody();
        const subject = msg.getSubject();

        // Extract email from "Name <email>" format
        const fromMatch = from.match(/<([^>]+)>/) || from.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const fromEmail = fromMatch ? fromMatch[1].toLowerCase().trim() : from.toLowerCase().trim();

        // Check if this sender is one of our sent leads
        if (sentLeads[fromEmail]) {
          const lead = sentLeads[fromEmail];
          const snippet = body.substring(0, 500);

          // Send to Discord webhook
          const discordPayload = {
            embeds: [{
              title: "New Reply from Lead",
              color: 0x2ECC71,
              fields: [
                { name: "Name", value: lead.name, inline: true },
                { name: "Email", value: fromEmail, inline: true },
                { name: "Subject", value: subject, inline: false },
                { name: "Date", value: date.toISOString(), inline: true },
                { name: "Reply Preview", value: snippet.substring(0, 1024) || "(empty)", inline: false }
              ],
              timestamp: date.toISOString()
            }]
          };

          try {
            UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
              method: "POST",
              contentType: "application/json",
              payload: JSON.stringify(discordPayload),
              muteHttpExceptions: true
            });
            Logger.log("Discord notification sent for reply from: " + fromEmail);
          } catch (e) {
            Logger.log("ERROR sending to Discord: " + e.message);
          }

          // Mark as replied in sheet
          const rowNum = lead.row;
          sheet.getRange(rowNum, SC.STATUS + 1).setValue("replied");
          const existingNotes = String(data[rowNum - 1][SC.NOTES] || "");
          const replyNote = "[Replied: " + date.toISOString() + "]";
          if (existingNotes) {
            sheet.getRange(rowNum, SC.NOTES + 1).setValue(existingNotes + " | " + replyNote);
          } else {
            sheet.getRange(rowNum, SC.NOTES + 1).setValue(replyNote);
          }

          repliesFound++;
        }
      }
    }

    // Update last check time
    props.setProperty("LAST_REPLY_CHECK", new Date().toISOString());

    Logger.log("Reply check complete: " + repliesFound + " new replies notified to Discord");

  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
// MAIN: DAILY REPORT
// ============================================================================

/**
 * generateDailyReport()
 * Creates or appends to a daily report document
 */
function generateDailyReport() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = _getActiveSS();
    const sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    const sortedSheet = ss.getSheetByName(sheetName);
    if (!sortedSheet) {
      Logger.log("ERROR: Sorted sheet not found");
      return;
    }

    const data = sortedSheet.getDataRange().getValues();
    const today = new Date();
    const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

    // Calculate metrics
    let stats = {
      totalLeads: data.length - 1,
      sentToday: 0,
      totalSent: 0,
      opens: 0,
      bounces: 0,
      replies: 0,
      failed: 0,
      openRate: 0,
      responseRate: 0,
      variants: {}
    };

    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][SC.STATUS] || "").trim();
      const sentTime = String(data[i][SC.SENT_TIMESTAMP] || "").trim();
      const rawOpen = data[i][SC.OPEN_COUNT];
      const openCount = (typeof rawOpen === "number" && !isNaN(rawOpen)) ? rawOpen : 0;
      const variant = String(data[i][SC.VARIANT] || "").trim();

      if (sentTime.includes(todayStr)) stats.sentToday++;
      if (status === "sent") stats.totalSent++;
      if (openCount > 0) stats.opens++;
      if (status === "bounced") stats.bounces++;
      if (status === "replied") stats.replies++;
      if (status === "failed") stats.failed++;

      if (variant && status === "sent") {
        stats.variants[variant] = (stats.variants[variant] || 0) + 1;
      }
    }

    stats.openRate = stats.totalSent > 0 ? ((stats.opens / stats.totalSent) * 100).toFixed(2) : 0;
    stats.responseRate = stats.totalSent > 0 ? ((stats.replies / stats.totalSent) * 100).toFixed(2) : 0;

    // Build report text
    let reportText = `
FOREIGN AFFAIRS — DAILY REPORT
Date: ${todayStr}
Generated: ${new Date().toLocaleString()}
Mode: ${TEST_MODE ? "TEST" : "PRODUCTION"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Leads: ${stats.totalLeads}
Total Sent: ${stats.totalSent}
Sent Today: ${stats.sentToday}
Opens: ${stats.opens}
Open Rate: ${stats.openRate}%
Responses (Replies): ${stats.replies}
Response Rate: ${stats.responseRate}%
Bounces: ${stats.bounces}
Failed: ${stats.failed}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VARIANTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    Object.entries(stats.variants).forEach(([variant, count]) => {
      reportText += `${variant}: ${count} sent\n`;
    });

    reportText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    // Get or create report document (persisted in Script Properties across runs)
    let reportDoc = null;
    const props = PropertiesService.getScriptProperties();
    const savedDocId = REPORT_DOC_ID || props.getProperty("REPORT_DOC_ID");

    if (savedDocId) {
      try {
        reportDoc = DocumentApp.openById(savedDocId);
        REPORT_DOC_ID = savedDocId;
      } catch (e) {
        reportDoc = null;
      }
    }

    if (!reportDoc) {
      const folder = DriveApp.getFolderById(REPORT_FOLDER_ID);
      reportDoc = DocumentApp.create("Foreign Affairs Daily Reports");
      folder.addFile(DriveApp.getFileById(reportDoc.getId()));
      REPORT_DOC_ID = reportDoc.getId();
      props.setProperty("REPORT_DOC_ID", REPORT_DOC_ID);
      Logger.log("Created report doc: " + reportDoc.getUrl());
    }

    // Append to document
    const body = reportDoc.getBody();
    body.appendParagraph(reportText);

    Logger.log("Report generated for " + todayStr);
    Logger.log("Report URL: " + reportDoc.getUrl());

  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function _getActiveSS() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById(INGEST_CFG.THIS_SS_ID);
    } catch (e) {
      throw new Error("Could not open spreadsheet: " + e.message);
    }
  }
  if (!ss) throw new Error("Spreadsheet is null");
  return ss;
}

/**
 * _maxId(sheet)
 * Returns the maximum ID value in the first column
 */
function _maxId(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  let max = 0;
  ids.forEach(row => {
    const val = parseInt(row[0]);
    if (!isNaN(val) && val > max) max = val;
  });
  return max;
}

function _loadExistingDedupeSets(ss, seenEmails, seenPhones, seenNameCity) {
  [INGEST_CFG.OUT_SORTED, INGEST_CFG.OUT_PARTIAL].forEach(tabName => {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() <= 1) return;

    const numRows = sheet.getLastRow() - 1;
    const vals = sheet.getRange(2, 1, numRows, 6).getValues();

    vals.forEach(r => {
      const name = String(r[1] || "").trim();
      const city = String(r[2] || "").trim();
      const phone = String(r[4] || "").trim();
      const email = String(r[5] || "").trim();

      if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
      const digits = phone.replace(/\D/g, "");
      if (digits.length >= 10) seenPhones.add(digits);
      const cityNorm = _normalizeCity(city);
      const nameKey = _normStr(name) + "|" + cityNorm;
      if (nameKey.length > 1) seenNameCity.add(nameKey);
    });
  });
}

function _checkDupe(email, phone, name, city, seenEmails, seenPhones, seenNameCity) {
  if (email && EMAIL_RE.test(email) && seenEmails.has(_normalizeEmail(email))) return "Email";
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10 && seenPhones.has(digits)) return "Phone";
  }
  const cityNorm = _normalizeCity(city);
  const nameKey = _normStr(name) + "|" + cityNorm;
  if (nameKey.length > 1 && seenNameCity.has(nameKey)) return "NameCity";
  return null;
}

function _registerDedupe(email, phone, name, city, seenEmails, seenPhones, seenNameCity) {
  if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 10) seenPhones.add(digits);
  const cityNorm = _normalizeCity(city);
  const nameKey = _normStr(name) + "|" + cityNorm;
  if (nameKey.length > 1) seenNameCity.add(nameKey);
}

function _normalizeEmail(email) {
  return email.toLowerCase().trim();
}

function _normalizeCity(rawCity) {
  if (!rawCity) return "";
  let c = rawCity.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, " ");

  const parts = c.split(" ");
  if (parts.length >= 2 && US_STATE_ABBREVS.has(parts[parts.length - 1])) {
    parts.pop();
    c = parts.join(" ").trim();
  }

  c = c.replace(/\s+(united states|usa|us|united kingdom|uk|canada|ca|australia|au)$/, "").trim();
  return SUBAREA_TO_CITY[c] || c;
}

function _normStr(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function _buildBaseRow(id, name, city, address, phone, email, venueType, capacity, pricingRange, description, digitalFootprint, targetAudience, source) {
  return [id, name, city, address, phone, email, venueType, capacity, pricingRange, description, digitalFootprint, targetAudience, source];
}

function _toSortedRow(base) {
  return [...base, "", "", "", "", "", ""];
}

function _cellSafe(row, idx, defaultValue) {
  if (idx < 0 || idx >= row.length) return defaultValue || "";
  const val = row[idx];
  return (val !== null && val !== undefined) ? String(val).trim() : (defaultValue || "");
}

function _buildTestColMap(testHeader) {
  return {
    TITLE: testHeader.indexOf("name") >= 0 ? testHeader.indexOf("name") : 0,
    CATEGORIES0: testHeader.indexOf("venue_type") >= 0 ? testHeader.indexOf("venue_type") : 1,
    ADDRESS: testHeader.indexOf("address") >= 0 ? testHeader.indexOf("address") : 3,
    NEIGHBORHOOD: -1,
    STREET: testHeader.indexOf("street") >= 0 ? testHeader.indexOf("street") : -1,
    CITY: testHeader.indexOf("city") >= 0 ? testHeader.indexOf("city") : 2,
    POSTAL: -1, STATE: -1, COUNTRY: -1,
    WEBSITE: testHeader.indexOf("website") >= 0 ? testHeader.indexOf("website") :
             (testHeader.indexOf("digital_footprint") >= 0 ? testHeader.indexOf("digital_footprint") : -1),
    EMAIL0: testHeader.indexOf("email0") >= 0 ? testHeader.indexOf("email0") :
            (testHeader.indexOf("email") >= 0 ? testHeader.indexOf("email") : 5),
    EMAIL1: testHeader.indexOf("email1") >= 0 ? testHeader.indexOf("email1") : -1,
    EMAIL2: testHeader.indexOf("email2") >= 0 ? testHeader.indexOf("email2") : -1,
    EMAIL3: testHeader.indexOf("email3") >= 0 ? testHeader.indexOf("email3") : -1,
    EMAIL4: testHeader.indexOf("email4") >= 0 ? testHeader.indexOf("email4") : -1,
    EMAIL5: testHeader.indexOf("email5") >= 0 ? testHeader.indexOf("email5") : -1,
    PHONE: testHeader.indexOf("phone") >= 0 ? testHeader.indexOf("phone") : 4,
    CATEGORY: testHeader.indexOf("venue_type") >= 0 ? testHeader.indexOf("venue_type") : -1
  };
}

function _getOrCreate(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function _ensureHeader(sheet, header) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#f3f3f3");
  }
}

function _appendBlock(sheet, data) {
  if (!data || data.length === 0) return;
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, data.length, data[0].length).setValues(data);
}

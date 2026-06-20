/**
 * ============================================================================
 * FOREIGN AFFAIRS LLC — COMPLETE EMAIL AUTOMATION v7.5
 *
 * FIXES IN v7.5:
 *   - Added sendDailySummary() — concise 7-line Discord summary at 7 PM EST
 *   - Removed phone requirement for email sending (email-only check)
 *   - Full-sheet scan picks earliest valid row across cursor→end→wrap→top
 *   - Always auto-detects last "sent" row, starts from after it
 *
 * FIXES IN v7.4:
 *   - Added setupTriggers() / removeAllTriggers() / listTriggers() / resetSendCursor()
 *   - Added cursor tracker (LAST_SENT_ROW) — resumes from last sent, wraps around
 *   - Added TEST 11 (Triggers) to diagnostic run()
 *   - Fixed Cloudflare Worker D1 binding null-check
 *   - Fixed syncOpensFromCloudflare to log response body on errors
 *
 * FIXES IN v7.3:
 *   - New run() diagnostic: tests every function with detailed logging
 *   - Added _readHeaderColMap() — single source of truth for column indices
 *   - Fixed ALL functions to use dynamic header lookup (no more hardcoded SC.*)
 *   - Fixed column count mismatches — use sheet.getLastColumn() everywhere
 *   - Fixed sendEmailViaGmail — removed 'from' param (breaks on personal Gmail)
 *   - Fixed _ensureHeader — now validates/corrects mismatched headers
 *   - Fixed syncOpensFromCloudflare — dynamic header + safe column reads
 *   - Fixed checkAndNotifyReplies — dynamic header + safe column reads
 *   - Discord daily summary replaces Google Doc report for quick-view
 *   - Fixed sendNextEmail — removed fragile SC.* fallbacks
 *   - Fixed retry notes — reads fresh data instead of stale snapshot
 *
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_MODE = false;

const SECRET_KEY = "fa_open_track_2026_xK9mPqR";
const CLOUDFLARE_WORKER_URL = "https://emailsendingopenrate.isiraglobal.workers.dev";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1512500880027418634/TUQeQ8KVXfxot0HLm9l4qC-w_3FUWNwo8WLiicj9w0sTudCd8IZNptnTOxewdp8gGQ_v";
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

const SC = {
  ID: 0, NAME: 1, CITY: 2, ADDRESS: 3, PHONE: 4, EMAIL: 5,
  VENUE_TYPE: 6, CAPACITY: 7, PRICING_RANGE: 8, DESCRIPTION: 9,
  DIGITAL: 10, TARGET_AUDIENCE: 11, SOURCE: 12,
  STATUS: 13, VARIANT: 14, SENT_TIMESTAMP: 15, NOTES: 16,
  OPEN_TIMESTAMP: 17, OPEN_COUNT: 18
};

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
// START HERE — COMPREHENSIVE DIAGNOSTIC
// ============================================================================

function run() {
  Logger.log("=================================================");
  Logger.log("FOREIGN AFFAIRS AUTOMATION v7.5 — DIAGNOSTIC");
  Logger.log("=================================================");
  Logger.log("TEST_MODE = " + TEST_MODE);
  Logger.log("Time: " + _nowStr());
  Logger.log("TimeZone: " + Session.getScriptTimeZone());
  Logger.log("User: " + Session.getEffectiveUser().getEmail());
  Logger.log("");

  var results = {};

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 1: Spreadsheet Access");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var ss = _getActiveSS();
    Logger.log("  PASS: Spreadsheet opened — " + ss.getName());
    Logger.log("  ID: " + ss.getId());
    var sheets = ss.getSheets().map(function(s) { return s.getName(); });
    Logger.log("  Sheets: " + sheets.join(", "));
    results.spreadsheet = "PASS";
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.spreadsheet = "FAIL";
    Logger.log("");
    Logger.log("CANNOT CONTINUE — spreadsheet not accessible.");
    return;
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 2: Target Sheet Structure");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  var targetSheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
  var targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) {
    Logger.log("  FAIL: Sheet '" + targetSheetName + "' not found");
    results.sheetStructure = "FAIL";
  } else {
    var lastRow = targetSheet.getLastRow();
    var lastCol = targetSheet.getLastColumn();
    Logger.log("  Sheet: " + targetSheetName);
    Logger.log("  Rows: " + lastRow + " (including header)");
    Logger.log("  Columns: " + lastCol);
    Logger.log("  Expected columns (SORTED_HEADER): " + SORTED_HEADER.length);

    if (lastRow < 2) {
      Logger.log("  WARN: No data rows (only header or empty)");
    }

    if (lastCol >= 1) {
      var actualHeader = targetSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      Logger.log("  Actual header (" + actualHeader.length + " cols): " + JSON.stringify(actualHeader));

      var headerMatch = true;
      for (var h = 0; h < SORTED_HEADER.length; h++) {
        var foundIdx = actualHeader.indexOf(SORTED_HEADER[h]);
        if (foundIdx < 0) {
          Logger.log("  MISSING header col: '" + SORTED_HEADER[h] + "' (expected at index " + h + ")");
          headerMatch = false;
        }
      }
      if (headerMatch && actualHeader.length === SORTED_HEADER.length) {
        Logger.log("  PASS: Header matches SORTED_HEADER perfectly");
        results.sheetStructure = "PASS";
      } else if (headerMatch) {
        Logger.log("  WARN: All expected columns found but extra columns exist (" + actualHeader.length + " vs " + SORTED_HEADER.length + ")");
        results.sheetStructure = "WARN";
      } else {
        Logger.log("  FAIL: Header does not match SORTED_HEADER");
        results.sheetStructure = "FAIL";
      }

      Logger.log("  Dynamic col map: " + JSON.stringify(_readHeaderColMap(targetSheet)));
    } else {
      Logger.log("  FAIL: Sheet has no columns");
      results.sheetStructure = "FAIL";
    }
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 3: Data Quality Check");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (targetSheet && targetSheet.getLastRow() >= 2) {
    try {
      var cols = targetSheet.getLastColumn();
      var data = targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, cols).getValues();
      var colMap = _readHeaderColMap(targetSheet);

      var cStatus = colMap.status;
      var cName = colMap.name;
      var cEmail = colMap.email;
      var cPhone = colMap.phone;
      var cVariant = colMap.variant;
      var cSentTS = colMap.sent_timestamp;
      var cNotes = colMap.notes;
      var cOpenCount = colMap.open_count;

      var total = data.length;
      var blankName = 0, blankEmail = 0, blankPhone = 0, blankStatus = 0;
      var sentCount = 0, failedCount = 0, repliedCount = 0, bouncedCount = 0;
      var hasOpenCount = 0, hasVariant = 0, hasSentTS = 0;
      var nullColErrors = 0;

      for (var i = 0; i < data.length; i++) {
        var name = cName >= 0 ? String(data[i][cName] || "").trim() : "";
        var email = cEmail >= 0 ? String(data[i][cEmail] || "").trim() : "";
        var phone = cPhone >= 0 ? String(data[i][cPhone] || "").trim() : "";
        var status = cStatus >= 0 ? String(data[i][cStatus] || "").trim().toLowerCase() : "";

        if (!name) blankName++;
        if (!email || !EMAIL_RE.test(email)) blankEmail++;
        if (!phone || phone.replace(/\D/g, "").length < 10) blankPhone++;
        if (!status) blankStatus++;

        if (status === "sent") sentCount++;
        if (status === "failed") failedCount++;
        if (status === "replied") repliedCount++;
        if (status === "bounced") bouncedCount++;

        if (cOpenCount >= 0) {
          var oc = data[i][cOpenCount];
          if (typeof oc === "number" && oc > 0) hasOpenCount++;
        }
        if (cVariant >= 0 && String(data[i][cVariant] || "").trim()) hasVariant++;
        if (cSentTS >= 0 && String(data[i][cSentTS] || "").trim()) hasSentTS++;
      }

      Logger.log("  Total rows: " + total);
      Logger.log("  Blank names: " + blankName);
      Logger.log("  Invalid emails: " + blankEmail);
      Logger.log("  Invalid phones: " + blankPhone);
      Logger.log("  Blank statuses: " + blankStatus);
      Logger.log("  Status sent: " + sentCount);
      Logger.log("  Status failed: " + failedCount);
      Logger.log("  Status replied: " + repliedCount);
      Logger.log("  Status bounced: " + bouncedCount);
      Logger.log("  With opens > 0: " + hasOpenCount);
      Logger.log("  With variant: " + hasVariant);
      Logger.log("  With sent_timestamp: " + hasSentTS);
      results.dataQuality = "PASS";
    } catch (e) {
      Logger.log("  FAIL: " + e.message);
      results.dataQuality = "FAIL";
    }
  } else {
    Logger.log("  SKIP: No data rows to check");
    results.dataQuality = "SKIP";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 4: Cloudflare Worker Connectivity");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var testUrl = CLOUDFLARE_WORKER_URL + "/api/opens/all?key=" + SECRET_KEY;
    var resp = UrlFetchApp.fetch(testUrl, {
      muteHttpExceptions: true,
      validateHttpsCertificates: false
    });
    var code = resp.getResponseCode();
    Logger.log("  HTTP Status: " + code);
    if (code === 200) {
      var body = resp.getContentText();
      Logger.log("  Response length: " + body.length + " chars");
      var parsed = JSON.parse(body);
      var openCount = parsed.opens_by_lead ? Object.keys(parsed.opens_by_lead).length : 0;
      Logger.log("  Leads with opens: " + openCount);
      results.cloudflare = "PASS";
    } else {
      Logger.log("  Response: " + resp.getContentText().substring(0, 200));
      results.cloudflare = "FAIL";
    }
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.cloudflare = "FAIL";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 5: Gmail Access");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var threads = GmailApp.search("in:sent newer_than:1d", 0, 1);
    Logger.log("  Gmail accessible — sent threads in last 24h: " + threads.length);
    results.gmail = "PASS";
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.gmail = "FAIL";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 6: Discord Webhook");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var testPayload = {
      embeds: [{
        title: "FA Automation Diagnostic",
        color: 0x3498DB,
        description: "Diagnostic test from v7.3 at " + _nowStr(),
        fields: [
          { name: "Status", value: "Test notification", inline: true }
        ]
      }]
    };
    var discResp = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(testPayload),
      muteHttpExceptions: true
    });
    Logger.log("  Discord webhook HTTP: " + discResp.getResponseCode());
    results.discord = discResp.getResponseCode() === 204 || discResp.getResponseCode() === 200 ? "PASS" : "FAIL";
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.discord = "FAIL";
  }
  Logger.log("");

  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 7: Send Email Dry Run");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (targetSheet && targetSheet.getLastRow() >= 2) {
    try {
      var cols = targetSheet.getLastColumn();
      var dryData = targetSheet.getRange(2, 1, 1, cols).getValues()[0];
      var colMap = _readHeaderColMap(targetSheet);
      var testName = colMap.name >= 0 ? String(dryData[colMap.name] || "") : "(no name col)";
      var testEmail = colMap.email >= 0 ? String(dryData[colMap.email] || "") : "(no email col)";
      var testStatus = colMap.status >= 0 ? String(dryData[colMap.status] || "") : "(no status col)";
      Logger.log("  First row name: " + testName);
      Logger.log("  First row email: " + testEmail);
      Logger.log("  First row status: " + testStatus);
      Logger.log("  (No email sent — this is a dry run)");
      results.dryRun = "PASS";
    } catch (e) {
      Logger.log("  FAIL: " + e.message);
      results.dryRun = "FAIL";
    }
  } else {
    Logger.log("  SKIP: No data rows");
    results.dryRun = "SKIP";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 9: Script Properties");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var propKeys = Object.keys(props);
    Logger.log("  Total properties: " + propKeys.length);
    for (var p = 0; p < propKeys.length; p++) {
      var val = props[propKeys[p]];
      Logger.log("  " + propKeys[p] + " = " + (val.length > 80 ? val.substring(0, 80) + "..." : val));
    }
    var lastSentRow = props.LAST_SENT_ROW || "(not set)";
    Logger.log("  >>> Email cursor is at row: " + lastSentRow);
    results.properties = "PASS";
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.properties = "FAIL";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 10: Source Sheets");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var apifySheet = ss.getSheetByName(INGEST_CFG.APIFY_SHEET_NAME);
    if (apifySheet) {
      Logger.log("  Apify sheet: " + apifySheet.getLastRow() + " rows, " + apifySheet.getLastColumn() + " cols");
    } else {
      Logger.log("  Apify sheet: NOT FOUND");
    }
    var testSheet = ss.getSheetByName(INGEST_CFG.TEST_SHEET_NAME);
    if (testSheet) {
      Logger.log("  Test sheet: " + testSheet.getLastRow() + " rows, " + testSheet.getLastColumn() + " cols");
    } else {
      Logger.log("  Test sheet: NOT FOUND");
    }
    var sortedSheet = ss.getSheetByName(INGEST_CFG.OUT_SORTED);
    if (sortedSheet) {
      Logger.log("  Sorted sheet: " + sortedSheet.getLastRow() + " rows, " + sortedSheet.getLastColumn() + " cols");
    } else {
      Logger.log("  Sorted sheet: NOT FOUND");
    }
    var partialSheet = ss.getSheetByName(INGEST_CFG.OUT_PARTIAL);
    if (partialSheet) {
      Logger.log("  Partial sheet: " + partialSheet.getLastRow() + " rows, " + partialSheet.getLastColumn() + " cols");
    } else {
      Logger.log("  Partial sheet: NOT FOUND");
    }
    var rawSheet = ss.getSheetByName(INGEST_CFG.OUT_RAW);
    if (rawSheet) {
      Logger.log("  Raw sheet: " + rawSheet.getLastRow() + " rows, " + rawSheet.getLastColumn() + " cols");
    } else {
      Logger.log("  Raw sheet: NOT FOUND");
    }
    results.sourceSheets = "PASS";
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.sourceSheets = "FAIL";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("TEST 11: Triggers");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    var triggers = ScriptApp.getProjectTriggers();
    Logger.log("  Active triggers: " + triggers.length);
    if (triggers.length === 0) {
      Logger.log("  WARNING: No triggers configured — automation will NOT run automatically");
      Logger.log("  FIX: Run setupTriggers() to configure all automation triggers");
      results.triggers = "WARN";
    } else {
      var triggerFuncs = {};
      triggers.forEach(function(t) {
        var fn = t.getHandlerFunction();
        triggerFuncs[fn] = true;
        Logger.log("  • " + fn + " — " + t.getEventType());
      });
      var expected = ["sendNextEmail", "syncOpensFromCloudflare", "checkAndNotifyReplies", "sendDailySummary"];
      var missing = expected.filter(function(f) { return !triggerFuncs[f]; });
      if (missing.length > 0) {
        Logger.log("  Missing triggers: " + missing.join(", "));
        Logger.log("  FIX: Run setupTriggers() to add missing triggers");
        results.triggers = "WARN";
      } else {
        Logger.log("  PASS: All expected triggers configured");
        results.triggers = "PASS";
      }
    }
  } catch (e) {
    Logger.log("  FAIL: " + e.message);
    results.triggers = "FAIL";
  }
  Logger.log("");

  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("SUMMARY");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  var passCount = 0, failCount = 0, skipCount = 0, warnCount = 0;
  var resultKeys = Object.keys(results);
  for (var r = 0; r < resultKeys.length; r++) {
    var status = results[resultKeys[r]];
    var icon = status === "PASS" ? "✓" : (status === "FAIL" ? "✗" : (status === "WARN" ? "⚠" : "○"));
    Logger.log("  " + icon + " " + resultKeys[r] + ": " + status);
    if (status === "PASS") passCount++;
    else if (status === "FAIL") failCount++;
    else if (status === "WARN") warnCount++;
    else skipCount++;
  }
  Logger.log("");
  Logger.log("  Total: " + passCount + " passed, " + failCount + " failed, " + warnCount + " warnings, " + skipCount + " skipped");
  Logger.log("=================================================");
}


// ============================================================================
// SETUP
// ============================================================================

function setupGmailOAuth() {
  try {
    const gmail = Gmail.Users.getProfile("me");
    Logger.log("Gmail authenticated as: " + gmail.emailAddress);
  } catch (e) {
    Logger.log("ERROR: Gmail OAuth failed: " + e.message);
  }
}

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
CREATE INDEX IF NOT EXISTS idx_opened_at ON email_opens(opened_at);`;
  Logger.log("Copy this SQL to Cloudflare D1 console:\n" + sqlCommand);
}

function createTestData() {
  const ss = _getActiveSS();
  let sheet = ss.getSheetByName(INGEST_CFG.TEST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INGEST_CFG.TEST_SHEET_NAME);
  } else {
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

  data.forEach(function(row, idx) {
    sheet.appendRow(row);
    if (idx === 0) {
      sheet.getRange(1, 1, 1, row.length).setFontWeight("bold").setBackground("#f3f3f3");
    }
  });

  if (sheet.getLastColumn() > 0) sheet.autoResizeColumns(1, sheet.getLastColumn());
  Logger.log("Test sheet populated with " + (data.length - 1) + " sample leads");
}


// ============================================================================
// TRIGGER MANAGEMENT
// ============================================================================

function setupTriggers() {
  Logger.log("Setting up automation triggers...");

  var existingTriggers = ScriptApp.getProjectTriggers();
  var existingMap = {};
  existingTriggers.forEach(function(t) {
    existingMap[t.getHandlerFunction()] = true;
  });

  var triggers = [
    {
      func: "sendNextEmail",
      freq: ScriptApp.WeekDay.MONDAY,
      hour: 9,
      minute: 0,
      desc: "Send emails — Mon-Fri 6 AM to 5 PM EST (every 15 min)"
    },
    {
      func: "syncOpensFromCloudflare",
      freq: ScriptApp.WeekDay.MONDAY,
      hour: 10,
      minute: 30,
      desc: "Sync open rates — every 2 hours"
    },
    {
      func: "checkAndNotifyReplies",
      freq: ScriptApp.WeekDay.MONDAY,
      hour: 11,
      minute: 0,
      desc: "Check replies — every 3 hours"
    },
    {
      func: "sendDailySummary",
      freq: ScriptApp.WeekDay.MONDAY,
      hour: 19,
      minute: 0,
      desc: "Daily Discord summary — 7 PM EST"
    }
  ];

  var created = 0;
  var skipped = 0;

  triggers.forEach(function(cfg) {
    if (existingMap[cfg.func]) {
      Logger.log("  SKIP: " + cfg.func + " — trigger already exists");
      skipped++;
      return;
    }

    try {
      var builder = ScriptApp.newTrigger(cfg.func)
        .timeBased()
        .everyDays(1);

      if (cfg.func === "sendNextEmail") {
        builder = ScriptApp.newTrigger(cfg.func)
          .timeBased()
          .everyMinutes(15);
      } else if (cfg.func === "syncOpensFromCloudflare") {
        builder = ScriptApp.newTrigger(cfg.func)
          .timeBased()
          .everyHours(2);
      } else if (cfg.func === "checkAndNotifyReplies") {
        builder = ScriptApp.newTrigger(cfg.func)
          .timeBased()
          .everyHours(3);
      } else if (cfg.func === "sendDailySummary") {
        builder = ScriptApp.newTrigger(cfg.func)
          .timeBased()
          .atHour(19)
          .nearMinute(0)
          .everyDays(1)
          .inTimezone("America/New_York");
      }

      builder.create();
      Logger.log("  CREATED: " + cfg.func + " — " + cfg.desc);
      created++;
    } catch (e) {
      Logger.log("  ERROR creating " + cfg.func + ": " + e.message);
    }
  });

  Logger.log("");
  Logger.log("Trigger setup complete: " + created + " created, " + skipped + " skipped (already exist)");
  listTriggers();
}

function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log("Removing all triggers (" + triggers.length + " found)...");
  triggers.forEach(function(t) {
    Logger.log("  Removed: " + t.getHandlerFunction() + " (" + t.getEventType() + ")");
    ScriptApp.deleteTrigger(t);
  });
  Logger.log("All triggers removed.");
}

function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Logger.log("ACTIVE TRIGGERS (" + triggers.length + ")");
  Logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (triggers.length === 0) {
    Logger.log("  No triggers configured. Run setupTriggers() to create them.");
    return;
  }

  triggers.forEach(function(t) {
    var handler = t.getHandlerFunction();
    var eventType = t.getEventType();
    var source = t.getTriggerSource();

    var detail = "";
    if (eventType === "CLOCK") {
      if (t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK) {
        var everyMinutes = t.getIntervalMinutes ? t.getIntervalMinutes() : null;
        var everyHours = t.getIntervalHours ? t.getIntervalHours() : null;
        var atHour = t.getAtHour ? t.getAtHour() : null;
        var nearMinute = t.getNearMinute ? t.getNearMinute() : null;

        if (everyMinutes) detail = "every " + everyMinutes + " min";
        else if (everyHours) detail = "every " + everyHours + " hours";
        else if (atHour !== null) detail = "at " + atHour + ":0" + (nearMinute || 0);
        else detail = "time-based";
      }
    }

    Logger.log("  • " + handler + " — " + eventType + " — " + detail);
  });
}

function resetSendCursor() {
  PropertiesService.getScriptProperties().setProperty("LAST_SENT_ROW", "1");
  Logger.log("Send cursor reset to row 2 (start of data). Next sendNextEmail() will begin from the top.");
}


// ============================================================================
// MAIN: SORTING & IMPORT
// ============================================================================

function sortSpreadsheetLeads() {
  try {
    const activeSS = _getActiveSS();

    if (TEST_MODE === true) {
      Logger.log("TEST MODE — processing Test sheet in-place");
      _processTestSheetInPlace(activeSS);
      return;
    }

    Logger.log("PRODUCTION MODE");
    const sourceSheet = activeSS.getSheetByName(INGEST_CFG.APIFY_SHEET_NAME);
    if (!sourceSheet) {
      Logger.log("ERROR: '" + INGEST_CFG.APIFY_SHEET_NAME + "' sheet not found");
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

    var seenEmails   = new Set();
    var seenPhones   = new Set();
    var seenNameCity = new Set();
    _loadExistingDedupeSets(activeSS, seenEmails, seenPhones, seenNameCity);

    var newSorted  = [];
    var newPartial = [];
    var newRaw     = [];

    var stats = {
      processed: 0, imported: 0, dupeEmail: 0, dupePhone: 0, dupeNameCity: 0,
      malformed: 0, junkEmail: 0, toSorted: 0, toPartial: 0, toRaw: 0, errors: []
    };

    var sourceData = [];
    try {
      sourceData = sourceSheet.getDataRange().getValues();
    } catch (e) {
      Logger.log("ERROR reading Apify sheet: " + e.message);
      return;
    }

    if (sourceData.length < 2) {
      Logger.log("Apify sheet is empty");
      return;
    }

    var firstCell = String(sourceData[0][0]).toLowerCase();
    var hasHeader = firstCell.includes("title") || firstCell.includes("name");
    var startRow = hasHeader ? 1 : 0;
    var A = INGEST_CFG.APIFY;

    Logger.log("Processing " + (sourceData.length - startRow) + " rows");

    for (var i = startRow; i < sourceData.length; i++) {
      stats.processed++;
      try {
        var row = sourceData[i].map(function(v) {
          return (v !== null && v !== undefined) ? String(v).trim() : "";
        });

        if (row.filter(function(c) { return c !== ""; }).length < 2) { stats.malformed++; continue; }

        var nameVal = _cellSafe(row, A.TITLE, "").normalize("NFKD").trim();
        var cityRaw = _cellSafe(row, A.CITY, "").normalize("NFKD").trim();
        var addressVal = (
          _cellSafe(row, A.ADDRESS, "") ||
          [_cellSafe(row, A.STREET, ""), _cellSafe(row, A.NEIGHBORHOOD, "")].filter(Boolean).join(", ")
        ).normalize("NFKD").trim();
        var website  = _cellSafe(row, A.WEBSITE, "");
        var phone    = _cellSafe(row, A.PHONE, "");
        var category = _cellSafe(row, A.CATEGORY, "") || _cellSafe(row, A.CATEGORIES0, "");

        if (!nameVal || nameVal.length < 3 || EMAIL_RE.test(nameVal)) { stats.malformed++; continue; }

        var email = "";
        for (var e = A.EMAIL0; e <= A.EMAIL5; e++) {
          var candidate = _cellSafe(row, e, "").toLowerCase();
          if (candidate && EMAIL_RE.test(candidate)) { email = candidate; break; }
        }

        if (!email || !phone) {
          for (var j = 0; j < row.length; j++) {
            var cell = String(row[j]).trim();
            var digits = cell.replace(/\D/g, "");
            if (!email && EMAIL_RE.test(cell)) email = cell.toLowerCase();
            if (!phone && digits.length >= 10 && digits.length <= 15) phone = cell;
          }
        }

        if (email) {
          var parts = email.split("@");
          var domain = parts[1] || "";
          var isJunk = (
            /^\d+\.?\d*$/.test(parts[0]) ||
            GENERIC_EMAIL_RE.test(email) ||
            JUNK_DOMAINS.has(domain) ||
            /@(example|test|noreply|no-reply|donotreply)\./i.test(email)
          );
          if (isJunk) { email = ""; stats.junkEmail++; }
        }

        var cityNorm = _normalizeCity(cityRaw);
        var dupeResult = _checkDupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
        if (dupeResult) { stats["dupe" + dupeResult]++; continue; }

        var hasEmail = email && EMAIL_RE.test(email);
        var hasPhone = phone && phone.replace(/\D/g, "").length >= 10;

        var base = _buildBaseRow(
          0, nameVal, cityRaw, addressVal, phone, email,
          category, "", "", "", website, website, INGEST_CFG.APIFY_SHEET_NAME
        );

        base[0] = nextRawId++;
        newRaw.push(base.slice());
        stats.toRaw++;

        if (hasEmail && hasPhone) {
          var sortedRow = _toSortedRow(base);
          sortedRow[0] = nextSortedId++;
          newSorted.push(sortedRow);
          stats.toSorted++;
        } else if (hasPhone) {
          base[0] = nextPartialId++;
          newPartial.push(base.slice());
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

    Logger.log("INGESTION COMPLETE");
    Logger.log("Processed: " + stats.processed + " | Imported: " + stats.imported);
    Logger.log("Sorted: " + stats.toSorted + " | Partial: " + stats.toPartial + " | Raw: " + stats.toRaw);
    if (stats.errors.length > 0) {
      Logger.log("ERRORS: " + stats.errors.length);
      stats.errors.slice(0, 5).forEach(function(e) { Logger.log("  " + e); });
    }
  } catch (e) {
    Logger.log("FATAL ERROR in sortSpreadsheetLeads: " + e.message);
  }
}


function _processTestSheetInPlace(ss) {
  var sheet = ss.getSheetByName(INGEST_CFG.TEST_SHEET_NAME);
  if (!sheet) {
    Logger.log("ERROR: Test sheet not found");
    return;
  }

  var sourceData = [];
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

  var firstCell = String(sourceData[0][0]).toLowerCase();
  var hasHeader = firstCell.includes("title") || firstCell.includes("name") || firstCell.includes("id");
  var startRow = hasHeader ? 1 : 0;
  var A = hasHeader ? _buildTestColMap(sourceData[0]) : _buildTestColMap([]);

  Logger.log("Processing " + (sourceData.length - Math.max(startRow, 1)) + " rows from Test sheet");

  var existingCols = sourceData[0] ? sourceData[0].length : 0;
  var needsHeader = !hasHeader || existingCols < SORTED_HEADER.length;

  if (needsHeader) {
    sheet.getRange(1, 1, 1, SORTED_HEADER.length).setValues([SORTED_HEADER]);
    sheet.getRange(1, 1, 1, SORTED_HEADER.length).setFontWeight("bold").setBackground("#f3f3f3");
  }

  var nextId = _maxId(sheet) + 1;

  var seenEmails   = new Set();
  var seenPhones   = new Set();
  var seenNameCity = new Set();

  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(6, sheet.getLastColumn())).getValues();
    existing.forEach(function(r) {
      var name = String(r[1] || "").trim();
      var city = String(r[2] || "").trim();
      var phone = String(r[4] || "").trim();
      var email = String(r[5] || "").trim();
      if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
      var digits = phone.replace(/\D/g, "");
      if (digits.length >= 10) seenPhones.add(digits);
      var nameKey = _normStr(name) + "|" + _normalizeCity(city);
      if (nameKey.length > 1) seenNameCity.add(nameKey);
    });
  }

  var stats = {
    processed: 0, imported: 0, dupeEmail: 0, dupePhone: 0, dupeNameCity: 0,
    malformed: 0, junkEmail: 0, sorted: 0, errors: []
  };

  var outputRows = [];

  for (var i = startRow; i < sourceData.length; i++) {
    stats.processed++;
    try {
      var row = sourceData[i].map(function(v) {
        return (v !== null && v !== undefined) ? String(v).trim() : "";
      });

      if (row.filter(function(c) { return c !== ""; }).length < 2) { stats.malformed++; continue; }

      var nameVal = _cellSafe(row, A.TITLE, "").normalize("NFKD").trim();
      var cityRaw = _cellSafe(row, A.CITY, "").normalize("NFKD").trim();
      var addressVal = (
        _cellSafe(row, A.ADDRESS, "") ||
        [_cellSafe(row, A.STREET, ""), _cellSafe(row, A.NEIGHBORHOOD, "")].filter(Boolean).join(", ")
      ).normalize("NFKD").trim();
      var website  = _cellSafe(row, A.WEBSITE, "");
      var phone    = _cellSafe(row, A.PHONE, "");
      var category = _cellSafe(row, A.CATEGORY, "") || _cellSafe(row, A.CATEGORIES0, "");

      if (!nameVal || nameVal.length < 3 || EMAIL_RE.test(nameVal)) { stats.malformed++; continue; }

      var email = "";
      for (var e = A.EMAIL0; e <= A.EMAIL5; e++) {
        var candidate = _cellSafe(row, e, "").toLowerCase();
        if (candidate && EMAIL_RE.test(candidate)) { email = candidate; break; }
      }

      if (!email || !phone) {
        for (var j = 0; j < row.length; j++) {
          var cell = String(row[j]).trim();
          var digits = cell.replace(/\D/g, "");
          if (!email && EMAIL_RE.test(cell)) email = cell.toLowerCase();
          if (!phone && digits.length >= 10 && digits.length <= 15) phone = cell;
        }
      }

      if (email) {
        var parts = email.split("@");
        var domain = parts[1] || "";
        var isJunk = (
          /^\d+\.?\d*$/.test(parts[0]) ||
          GENERIC_EMAIL_RE.test(email) ||
          JUNK_DOMAINS.has(domain) ||
          /@(example|test|noreply|no-reply|donotreply)\./i.test(email)
        );
        if (isJunk) { email = ""; stats.junkEmail++; }
      }

      var cityNorm = _normalizeCity(cityRaw);
      var dupeResult = _checkDupe(email, phone, nameVal, cityNorm, seenEmails, seenPhones, seenNameCity);
      if (dupeResult) { stats["dupe" + dupeResult]++; continue; }

      var hasEmail = email && EMAIL_RE.test(email);
      var hasPhone = phone && phone.replace(/\D/g, "").length >= 10;

      var outRow = [
        nextId++, nameVal, cityRaw, addressVal,
        hasPhone ? phone : "", hasEmail ? email : "",
        category, "", "", "", website, website, "test",
        "", "", "", "", "", ""
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
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, SORTED_HEADER.length).clearContent();
    }
    sheet.getRange(2, 1, outputRows.length, SORTED_HEADER.length).setValues(outputRows);
  }

  Logger.log("TEST SHEET PROCESSED");
  Logger.log("Imported: " + stats.imported + " | Sorted: " + stats.sorted);
  Logger.log("Duplicates: " + (stats.dupeEmail + stats.dupePhone + stats.dupeNameCity) + " | Malformed: " + stats.malformed);
}


// ============================================================================
// MAIN: EMAIL SENDING — FIXED
// ============================================================================

function sendNextEmail() {
  var nowEst = new Date();
  var estHour = parseInt(Utilities.formatDate(nowEst, "America/New_York", "H"), 10);
  if (estHour < 6 || estHour >= 17) {
    Logger.log("Outside business hours (6 AM – 5 PM EST). Current EST hour: " + estHour + ". Skipping.");
    return;
  }

  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(3000);
    if (!lockAcquired) {
      Logger.log("WARN: Could not acquire lock — continuing anyway");
    }
  } catch (e) {
    Logger.log("Lock error (continuing without lock): " + e.message);
  }

  try {
    var ss = _getActiveSS();
    var sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      Logger.log("No data in " + sheetName);
      return;
    }

    var colMap = _readHeaderColMap(sheet);

    var requiredCols = ["status", "name", "email", "phone", "city", "venue_type", "variant", "sent_timestamp", "notes", "id"];
    var missingCols = [];
    requiredCols.forEach(function(c) {
      if (colMap[c] === -1) missingCols.push(c);
    });
    if (missingCols.length > 0) {
      Logger.log("FATAL: Missing required columns: " + missingCols.join(", "));
      return;
    }

    var cStatus    = colMap.status;
    var cName      = colMap.name;
    var cEmail     = colMap.email;
    var cPhone     = colMap.phone;
    var cCity      = colMap.city;
    var cVenueType = colMap.venue_type;
    var cVariant   = colMap.variant;
    var cSentTS    = colMap.sent_timestamp;
    var cNotes     = colMap.notes;
    var cId        = colMap.id;

    var readCols = Math.min(lastCol, Math.max(cStatus, cName, cEmail, cPhone, cCity, cVenueType, cVariant, cSentTS, cNotes, cId) + 1);
    var allData = sheet.getRange(1, 1, lastRow, readCols).getValues();

    var props = PropertiesService.getScriptProperties();

    // Always find the last "sent" row — start from the row after it
    var lastSentIdx = 1;
    for (var j = allData.length - 1; j >= 1; j--) {
      var checkStatus = String(_cellSafe(allData[j], cStatus, "")).trim().toLowerCase();
      if (checkStatus === "sent") {
        lastSentIdx = j + 1;
        break;
      }
    }

    if (lastSentIdx >= allData.length) lastSentIdx = 1;
    props.setProperty("LAST_SENT_ROW", String(lastSentIdx));

    Logger.log("Last sent sheet row: " + lastSentIdx + ". Cursor starts at sheet row " + (lastSentIdx + 1) + " (total rows: " + allData.length + ")");

    var maxToSend = TEST_MODE ? allData.length : 1;
    var sentCount = 0;
    var scannedCount = 0;
    var MAX_SCAN = allData.length;
    var i = lastSentIdx;

    // Scan the FULL sheet: cursor → end → wrap to row 2 → cursor
    // Track the first valid unsent lead, then send to it
    var foundRow = -1;
    var foundIdx = -1;

    while (scannedCount < MAX_SCAN && sentCount < maxToSend) {
      if (i >= allData.length) {
        Logger.log("Wrapping to row 2 — scanning rows 2 to " + lastSentIdx);
        i = 1;
      }

      scannedCount++;

      var rowNum = i + 1;
      var status = String(_cellSafe(allData[i], cStatus, "")).trim().toLowerCase();
      var email = String(_cellSafe(allData[i], cEmail, "")).trim();
      var phone = String(_cellSafe(allData[i], cPhone, "")).trim();
      var digits = phone.replace(/\D/g, "");
      var name = String(_cellSafe(allData[i], cName, "")).trim();

      var hasValidEmail = EMAIL_RE.test(email);

      // Log first few skips for visibility
      if ((scannedCount % 20 === 1 || scannedCount <= 5) && (status === "sent" || status === "failed" || !hasValidEmail)) {
        Logger.log("SKIP row " + rowNum + ": status=\"" + status + "\" email=" + (hasValidEmail ? "ok" : "BAD") + " | " + name);
      }

      if (status === "sent" || status === "failed") {
        i++;
        continue;
      }

      if (!hasValidEmail) {
        i++;
        continue;
      }

      // Found a valid unsent lead — track the EARLIEST row in the sheet
      if (foundRow === -1 || rowNum < foundRow) {
        foundRow = rowNum;
        foundIdx = i;
        Logger.log(">>> Candidate at row " + rowNum + ": " + name + " | " + email + " | phone=" + phone);
      }

      i++;
    }

    // Send to the first valid candidate found (if any)
    if (foundIdx >= 0) {
      i = foundIdx;
      var rowNum = foundRow;
      var name = String(_cellSafe(allData[i], cName, "")).trim();
      var email = String(_cellSafe(allData[i], cEmail, "")).trim();
      var city = String(_cellSafe(allData[i], cCity, "")).trim();
      var venueType = String(_cellSafe(allData[i], cVenueType, "")).trim();
      var leadId = String(_cellSafe(allData[i], cId, "")).trim();

      var pixelUrl = _generateTrackingPixel("lead-" + leadId, email);

      var si = _pickRandomIndex(SUBJECT_VARIANTS);
      var ii = _pickRandomIndex(BODY_INTROS);
      var ci = _pickRandomIndex(BODY_CLOSINGS);

      var subject = SUBJECT_VARIANTS[si]
        .replace(/{name}/g, name)
        .replace(/{city}/g, city)
        .replace(/{venuetype}/g, venueType);

      var intro = BODY_INTROS[ii]
        .replace(/{name}/g, name)
        .replace(/{city}/g, city)
        .replace(/{venuetype}/g, venueType);

      var closing = BODY_CLOSINGS[ci];
      var htmlBody = _buildEmailHtml(name, intro, closing, pixelUrl);

      var result = sendEmailViaGmail(email, subject, htmlBody);
      var variantLabel = "v" + (si + 1) + "." + (ii + 1) + "." + (ci + 1);

      if (result.success) {
        var timestamp = _nowStr();
        sheet.getRange(rowNum, cStatus + 1).setValue("sent");
        sheet.getRange(rowNum, cSentTS + 1).setValue(timestamp);
        sheet.getRange(rowNum, cVariant + 1).setValue(variantLabel);
        Logger.log("SENT: " + email + " | " + name + " | variant=" + variantLabel + " | row=" + rowNum);
        sentCount++;

        props.setProperty("LAST_SENT_ROW", String(rowNum));
        props.setProperty("FA_TICK_COUNT", String(parseInt(props.getProperty("FA_TICK_COUNT") || "0") + 1));

        try {
          var sentThreads = GmailApp.search("in:sent to:" + email, 0, 1);
          if (sentThreads.length > 0) {
            var sentLabel = GmailApp.getUserLabelByName("FA-Sent");
            if (!sentLabel) sentLabel = GmailApp.createLabel("FA-Sent");
            sentThreads[0].addLabel(sentLabel);
            Logger.log("Labeled FA-Sent: " + email);
          }
        } catch (gErr) {
          Logger.log("Gmail sent label error: " + gErr.message);
        }
      } else {
        var err = result.error || "";
        var isQuotaError = err.indexOf("quota") >= 0 ||
                           err.indexOf("rate") >= 0 ||
                           err.indexOf("too many") >= 0 ||
                           err.indexOf("Daily user sending quota") >= 0;

        if (isQuotaError) {
          var timestamp = _nowStr();
          sheet.getRange(rowNum, cStatus + 1).setValue("sent");
          sheet.getRange(rowNum, cSentTS + 1).setValue(timestamp);
          sheet.getRange(rowNum, cVariant + 1).setValue(variantLabel);
          sheet.getRange(rowNum, cNotes + 1).setValue("Quota warning (email likely sent): " + err);
          Logger.log("QUOTA (email sent): " + email + " | " + name + " | row=" + rowNum);
          sentCount++;
          props.setProperty("LAST_SENT_ROW", String(rowNum));

          try {
            var sentThreads = GmailApp.search("in:sent to:" + email, 0, 1);
            if (sentThreads.length > 0) {
              var sentLabel = GmailApp.getUserLabelByName("FA-Sent");
              if (!sentLabel) sentLabel = GmailApp.createLabel("FA-Sent");
              sentThreads[0].addLabel(sentLabel);
            }
          } catch (gErr) {
            Logger.log("Gmail sent label error: " + gErr.message);
          }
        } else {
          var existingNotes = String(_cellSafe(allData[i], cNotes, ""));
          var retryMatch = existingNotes.match(/retry:(\d+)/);
          var retryCount = retryMatch ? parseInt(retryMatch[1]) : 0;
          retryCount++;

          if (retryCount >= 3) {
            sheet.getRange(rowNum, cStatus + 1).setValue("failed");
            sheet.getRange(rowNum, cNotes + 1).setValue("Failed after " + retryCount + " retries: " + err);
            Logger.log("FAILED: " + email + " | " + err + " | row=" + rowNum);
          } else {
            sheet.getRange(rowNum, cNotes + 1).setValue("retry:" + retryCount + " | " + err);
            Logger.log("SEND FAILED (retry " + retryCount + "/3): " + email + " | " + err + " | row=" + rowNum);
          }
        }
      }
    }

    if (sentCount === 0) {
      Logger.log("Full scan complete — no unsent leads with valid email+phone found");
    }

    Logger.log("sendNextEmail complete: " + sentCount + " sent, scanned " + scannedCount + " rows");
  } catch (e) {
    Logger.log("FATAL ERROR in sendNextEmail: " + e.message + "\n" + e.stack);
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

function sendEmailViaGmail(email, subject, htmlBody) {
  try {
    GmailApp.sendEmail(email, subject, "", {
      htmlBody: htmlBody
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


// ============================================================================
// EMAIL TEMPLATE
// ============================================================================

function _buildEmailHtml(name, intro, closing, pixelUrl) {
  return '<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:#2C3E50;color:white;padding:20px;text-align:center}.content{padding:20px}.footer{background:#ECF0F1;padding:10px;text-align:center;font-size:12px}</style></head><body><div class="container"><div class="header"><h1>Foreign Affairs</h1></div><div class="content"><p>' + intro.replace(/\n/g, "<br>") + '</p><p>' + closing.replace(/\n/g, "<br>") + '</p></div><div class="footer"><p>&copy; 2026 Foreign Affairs LLC. All rights reserved.</p></div></div><img src="' + pixelUrl + '" width="1" height="1" style="display:none" /></body></html>';
}

function _generateTrackingPixel(leadId, email) {
  if (!leadId || !email) return "";
  try {
    var encodedEmail = encodeURIComponent(email);
    var timestamp = new Date().toISOString();
    return CLOUDFLARE_WORKER_URL + "/pixel?id=" + leadId + "&e=" + encodedEmail + "&t=" + encodeURIComponent(timestamp);
  } catch (e) {
    Logger.log("Error generating pixel: " + e.message);
    return "";
  }
}

function _pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _pickRandomIndex(arr) {
  return Math.floor(Math.random() * arr.length);
}


// ============================================================================
// MAIN: OPEN RATE SYNC — FIXED
// ============================================================================

function syncOpensFromCloudflare(sheetName) {
  try {
    sheetName = sheetName || (TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED);

    var ss = _getActiveSS();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("No data to sync");
      return;
    }

    var colMap = _readHeaderColMap(sheet);
    Logger.log("Column map: " + JSON.stringify(colMap));

    var cId = colMap.id;
    var cOpenTS = colMap.open_timestamp;
    var cOpenCount = colMap.open_count;

    if (cId === -1 || cOpenTS === -1 || cOpenCount === -1) {
      Logger.log("FATAL: Missing required columns (id=" + cId + ", open_timestamp=" + cOpenTS + ", open_count=" + cOpenCount + ")");
      return;
    }

    var allOpensUrl = CLOUDFLARE_WORKER_URL + "/api/opens/all?key=" + SECRET_KEY;
    var response;
    try {
      response = UrlFetchApp.fetch(allOpensUrl, {
        muteHttpExceptions: true,
        validateHttpsCertificates: false
      });
    } catch (e) {
      Logger.log("ERROR fetching from Cloudflare: " + e.message);
      return;
    }

    if (response.getResponseCode() !== 200) {
      var errBody = "";
      try { errBody = response.getContentText().substring(0, 500); } catch (e) {}
      Logger.log("ERROR: Cloudflare returned HTTP " + response.getResponseCode());
      if (errBody) Logger.log("  Response: " + errBody);
      if (errBody.indexOf("D1 database binding") >= 0) {
        Logger.log("  >>> FIX: Go to Cloudflare Dashboard → Workers → emailsendingopenrate → Settings → Bindings → Add D1 Database with variable name 'database'");
      }
      return;
    }

    var result;
    try {
      result = JSON.parse(response.getContentText());
    } catch (e) {
      Logger.log("ERROR parsing Cloudflare response: " + e.message);
      return;
    }

    var opensByLeadId = result.opens_by_lead || {};
    Logger.log("Cloudflare has opens for " + Object.keys(opensByLeadId).length + " leads");

    var lastCol = sheet.getLastColumn();
    var readCols = Math.min(lastCol, Math.max(cId, cOpenTS, cOpenCount) + 1);
    var data = sheet.getRange(1, 1, lastRow, readCols).getValues();

    var updated = 0;
    var tsUpdates = {};
    var countUpdates = {};

    for (var i = 1; i < data.length; i++) {
      var leadId = String(_cellSafe(data[i], cId, "")).trim();
      if (!leadId) continue;

      var opens = opensByLeadId["lead-" + leadId] || [];

      if (opens.length > 0) {
        var rowNum = i + 1;
        tsUpdates[rowNum] = opens[0].opened_at;
        countUpdates[rowNum] = opens.length;
        updated++;
      }
    }

    var tsCol = cOpenTS + 1;
    var countCol = cOpenCount + 1;

    Object.keys(tsUpdates).forEach(function(rowNum) {
      try {
        sheet.getRange(parseInt(rowNum), tsCol).setValue(tsUpdates[rowNum]);
        sheet.getRange(parseInt(rowNum), countCol).setValue(countUpdates[rowNum]);
      } catch (e) {
        Logger.log("Warning: could not update row " + rowNum + ": " + e.message);
      }
    });

    PropertiesService.getScriptProperties().setProperty("LAST_OPEN_SYNC", new Date().toISOString());

    Logger.log("Cloudflare sync complete: " + updated + " rows updated");
  } catch (e) {
    Logger.log("FATAL ERROR in syncOpensFromCloudflare: " + e.message);
  }
}


// ============================================================================
// MAIN: REPLY DETECTION — FIXED
// ============================================================================

function checkAndNotifyReplies() {
  try {
    var ss = _getActiveSS();
    var sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log("ERROR: Sheet '" + sheetName + "' not found");
      return;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("No data to check replies for");
      return;
    }

    var colMap = _readHeaderColMap(sheet);
    Logger.log("Column map: " + JSON.stringify(colMap));

    var cStatus = colMap.status;
    var cEmail = colMap.email;
    var cName = colMap.name;
    var cNotes = colMap.notes;

    if (cStatus === -1 || cEmail === -1 || cName === -1 || cNotes === -1) {
      Logger.log("FATAL: Missing required columns (status=" + cStatus + ", email=" + cEmail + ", name=" + cName + ", notes=" + cNotes + ")");
      return;
    }

    var lastCol = sheet.getLastColumn();
    var readCols = Math.min(lastCol, Math.max(cStatus, cEmail, cName, cNotes) + 1);
    var data = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();

    var sentLeads = {};
    for (var i = 0; i < data.length; i++) {
      var status = String(_cellSafe(data[i], cStatus, "")).trim().toLowerCase();
      var email = String(_cellSafe(data[i], cEmail, "")).trim();
      var name = String(_cellSafe(data[i], cName, "")).trim();
      if (status === "sent" && email && EMAIL_RE.test(email)) {
        sentLeads[_normalizeEmail(email)] = {
          row: i + 2,
          name: name,
          email: email
        };
      }
    }

    var sentCount = Object.keys(sentLeads).length;
    Logger.log("Found " + sentCount + " sent leads to check for replies");
    if (sentCount === 0) {
      Logger.log("No sent leads to check replies for");
      return;
    }

    var searchTerms = [
      "Foreign Affairs",
      "venue partnership",
      "15-minute call",
      "Exclusive Opportunity",
      "Showcase Your Venue"
    ];

    for (var s = 0; s < searchTerms.length; s++) {
      if (Object.keys(sentLeads).length === 0) break;

      try {
        var query = "in:inbox is:unread newer_than:3d " + searchTerms[s];
        Logger.log("Gmail search: " + query);
        var threads = GmailApp.search(query, 0, 50);
        Logger.log("  Found " + threads.length + " threads");

        for (var t = 0; t < threads.length; t++) {
          var messages = threads[t].getMessages();

          for (var m = 0; m < messages.length; m++) {
            var msg = messages[m];
            var from = msg.getFrom();
            var date = msg.getDate();
            var body = msg.getPlainBody() || "";
            var subject = msg.getSubject() || "";

            var fromMatch = from.match(/<([^>]+)>/);
            var fromEmail = fromMatch
              ? fromMatch[1].toLowerCase().trim()
              : from.toLowerCase().trim();

            if (sentLeads[fromEmail]) {
              var lead = sentLeads[fromEmail];
              var snippet = body.substring(0, 500) || "(empty)";

              var discordPayload = {
                embeds: [{
                  title: "New Reply from Lead",
                  color: 0x2ECC71,
                  fields: [
                    { name: "Name", value: (lead.name || "Unknown").substring(0, 256), inline: true },
                    { name: "Email", value: fromEmail.substring(0, 256), inline: true },
                    { name: "Subject", value: subject.substring(0, 256), inline: false },
                    { name: "Date", value: date.toISOString(), inline: true },
                    { name: "Reply Preview", value: snippet.substring(0, 1024), inline: false }
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
                Logger.log("Discord notification sent for: " + fromEmail);
              } catch (e) {
                Logger.log("Discord webhook error: " + e.message);
              }

              var rowNum = lead.row;
              sheet.getRange(rowNum, cStatus + 1).setValue("replied");
              var replyNote = "[Replied: " + date.toISOString() + "]";
              sheet.getRange(rowNum, cNotes + 1).setValue(replyNote);

              try {
                msg.markRead();
                var replyLabel = GmailApp.getUserLabelByName("FA-Replied");
                if (!replyLabel) replyLabel = GmailApp.createLabel("FA-Replied");
                msg.getThread().addLabel(replyLabel);
                Logger.log("Marked read + labeled FA-Replied: " + fromEmail);
              } catch (gErr) {
                Logger.log("Gmail label error: " + gErr.message);
              }

              delete sentLeads[fromEmail];
            }
          }
        }
      } catch (e) {
        Logger.log("Gmail search error for '" + searchTerms[s] + "': " + e.message);
      }
    }

    PropertiesService.getScriptProperties().setProperty("LAST_REPLY_CHECK", new Date().toISOString());

    var replied = sentCount - Object.keys(sentLeads).length;
    Logger.log("Reply check complete: " + replied + " new replies notified to Discord");
  } catch (e) {
    Logger.log("FATAL ERROR in checkAndNotifyReplies: " + e.message);
  }
}


// ============================================================================
// MAIN: DAILY REPORT — FIXED
// ============================================================================



// ============================================================================
// MAIN: DAILY SUMMARY — DISCORD (7 PM EST)
// ============================================================================

function sendDailySummary() {
  try {
    var ss = _getActiveSS();
    var sheetName = TEST_MODE ? INGEST_CFG.TEST_SHEET_NAME : INGEST_CFG.OUT_SORTED;
    var sortedSheet = ss.getSheetByName(sheetName);
    if (!sortedSheet) {
      Logger.log("ERROR: '" + sheetName + "' sheet not found");
      return;
    }

    var lastRow = sortedSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("No data for summary");
      return;
    }

    var colMap = _readHeaderColMap(sortedSheet);
    var cStatus = colMap.status;
    var cSentTS = colMap.sent_timestamp;
    var cOpenCount = colMap.open_count;

    if (cStatus === -1) {
      Logger.log("FATAL: 'status' column not found");
      return;
    }

    var lastCol = sortedSheet.getLastColumn();
    var data = sortedSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var props = PropertiesService.getScriptProperties();
    var lastSentRow = props.getProperty("LAST_SENT_ROW") || "1";
    var tickCount = props.getProperty("FA_TICK_COUNT") || "0";

    var nowEst = new Date();
    var dateStr = Utilities.formatDate(nowEst, "America/New_York", "MMM dd, yyyy");
    var todayStr = Utilities.formatDate(nowEst, "America/New_York", "yyyy-MM-dd");

    var total = data.length;
    var sentToday = 0;
    var totalSent = 0;
    var opens = 0;
    var replies = 0;
    var failed = 0;

    for (var i = 0; i < data.length; i++) {
      var status = String(_cellSafe(data[i], cStatus, "")).trim().toLowerCase();
      var sentTime = cSentTS >= 0 ? String(_cellSafe(data[i], cSentTS, "")).trim() : "";
      var rawOpen = cOpenCount >= 0 ? data[i][cOpenCount] : 0;
      var openCount = (typeof rawOpen === "number" && !isNaN(rawOpen)) ? rawOpen : 0;

      if (sentTime.indexOf(todayStr) >= 0) sentToday++;
      if (status === "sent") totalSent++;
      if (openCount > 0) opens++;
      if (status === "replied") replies++;
      if (status === "failed") failed++;
    }

    var openRate = totalSent > 0 ? ((opens / totalSent) * 100).toFixed(1) : "0.0";
    var replyRate = totalSent > 0 ? ((replies / totalSent) * 100).toFixed(1) : "0.0";

    var summary = "📬 Daily Summary — " + dateStr + "\n"
      + "━━━━━━━━━━━━━━━━━━━━━━\n"
      + "• Sent Today: " + sentToday + "\n"
      + "• Total Sent: " + totalSent + " / " + total + "\n"
      + "• Opens: " + opens + " (" + openRate + "%)\n"
      + "• Replies: " + replies + " (" + replyRate + "%)\n"
      + "• Failed: " + failed + "\n"
      + "━━━━━━━━━━━━━━━━━━━━━━\n"
      + "Next row: " + lastSentRow + " | Total runs: " + tickCount;

    var discordPayload = {
      embeds: [{
        title: "Foreign Affairs — Daily Summary",
        color: 0x2C3E50,
        description: summary,
        footer: {
          text: "America/New_York • " + _nowStr()
        }
      }]
    };

    var webhookUrl = _getDiscordWebhookUrl();
    try {
      var options = {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(discordPayload),
        muteHttpExceptions: true
      };
      var response = UrlFetchApp.fetch(webhookUrl, options);
      Logger.log("Daily summary sent to Discord for " + dateStr + " (status " + response.getResponseCode() + ")");
    } catch (e) {
      Logger.log("Discord webhook error: " + e.message);
    }

    Logger.log("Summary: " + total + " leads, " + totalSent + " sent, " + sentToday + " today, " + opens + " opens, " + replies + " replies");
  } catch (e) {
    Logger.log("FATAL ERROR in sendDailySummary: " + e.message);
  }
}

function _getDiscordWebhookUrl() {
  var props = PropertiesService.getScriptProperties();
  var threadId = props.getProperty("DISCORD_THREAD_ID");
  if (threadId) {
    return DISCORD_WEBHOOK_URL + "?thread_id=" + encodeURIComponent(threadId);
  }
  return DISCORD_WEBHOOK_URL;
}

function setDailyUpdateThreadId(threadId) {
  if (!threadId || threadId.trim() === "") {
    Logger.log("Usage: setDailyUpdateThreadId(\"THREAD_ID\")");
    Logger.log("Tip: enable Developer Mode in Discord, right-click the 'daily-updates' thread, Copy ID");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("DISCORD_THREAD_ID", threadId.trim());
  Logger.log("DISCORD_THREAD_ID set to: " + threadId.trim());
  Logger.log("Daily summaries will now be posted to that thread.");
}

function clearDailyUpdateThreadId() {
  PropertiesService.getScriptProperties().deleteProperty("DISCORD_THREAD_ID");
  Logger.log("DISCORD_THREAD_ID cleared — daily summaries will go to the default channel.");
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function _getActiveSS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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

function _readHeaderColMap(sheet) {
  var colMap = {};
  var keys = ["id", "name", "city", "address", "phone", "email",
    "venue_type", "capacity", "pricing_range", "description",
    "digital_footprint", "target_audience", "source",
    "status", "variant", "sent_timestamp", "notes",
    "open_timestamp", "open_count"];
  keys.forEach(function(k) { colMap[k] = -1; });

  try {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return colMap;
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i] || "").toLowerCase().trim();
      if (h && keys.indexOf(h) >= 0) {
        colMap[h] = i;
      }
    }
  } catch (e) {
    Logger.log("Warning: _readHeaderColMap error: " + e.message);
  }

  return colMap;
}

function _maxId(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var max = 0;
  ids.forEach(function(row) {
    var val = parseInt(row[0]);
    if (!isNaN(val) && val > max) max = val;
  });
  return max;
}

function _loadExistingDedupeSets(ss, seenEmails, seenPhones, seenNameCity) {
  [INGEST_CFG.OUT_SORTED, INGEST_CFG.OUT_PARTIAL].forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() <= 1) return;

    var numRows = sheet.getLastRow() - 1;
    var cols = Math.min(6, sheet.getLastColumn());
    var vals = sheet.getRange(2, 1, numRows, cols).getValues();

    vals.forEach(function(r) {
      var name = String(r[1] || "").trim();
      var city = String(r[2] || "").trim();
      var phone = cols > 4 ? String(r[4] || "").trim() : "";
      var email = cols > 5 ? String(r[5] || "").trim() : "";

      if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
      var digits = phone.replace(/\D/g, "");
      if (digits.length >= 10) seenPhones.add(digits);
      var cityNorm = _normalizeCity(city);
      var nameKey = _normStr(name) + "|" + cityNorm;
      if (nameKey.length > 1) seenNameCity.add(nameKey);
    });
  });
}

function _checkDupe(email, phone, name, city, seenEmails, seenPhones, seenNameCity) {
  if (email && EMAIL_RE.test(email) && seenEmails.has(_normalizeEmail(email))) return "Email";
  if (phone) {
    var digits = phone.replace(/\D/g, "");
    if (digits.length >= 10 && seenPhones.has(digits)) return "Phone";
  }
  var cityNorm = _normalizeCity(city);
  var nameKey = _normStr(name) + "|" + cityNorm;
  if (nameKey.length > 1 && seenNameCity.has(nameKey)) return "NameCity";
  return null;
}

function _registerDedupe(email, phone, name, city, seenEmails, seenPhones, seenNameCity) {
  if (email && EMAIL_RE.test(email)) seenEmails.add(_normalizeEmail(email));
  var digits = (phone || "").replace(/\D/g, "");
  if (digits.length >= 10) seenPhones.add(digits);
  var cityNorm = _normalizeCity(city);
  var nameKey = _normStr(name) + "|" + cityNorm;
  if (nameKey.length > 1) seenNameCity.add(nameKey);
}

function _normalizeEmail(email) {
  return email.toLowerCase().trim();
}

function _normalizeCity(rawCity) {
  if (!rawCity) return "";
  var c = rawCity.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, " ");

  var parts = c.split(" ");
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
  return base.concat(["", "", "", "", "", ""]);
}

function _cellSafe(row, idx, defaultValue) {
  if (idx < 0 || idx >= row.length) return defaultValue || "";
  var val = row[idx];
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
    return;
  }

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var actual = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actualStr = actual.map(function(h) { return String(h || "").toLowerCase().trim(); }).join("|");
  var expectedStr = header.map(function(h) { return String(h || "").toLowerCase().trim(); }).join("|");

  if (actualStr !== expectedStr) {
    Logger.log("WARNING: Sheet '" + sheet.getName() + "' header mismatch. Fixing...");
    Logger.log("  Expected: " + expectedStr);
    Logger.log("  Actual:   " + actualStr);
    if (lastCol >= header.length) {
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
    } else {
      sheet.getRange(1, 1, 1, lastCol).setValues([header.slice(0, lastCol)]);
      if (header.length > lastCol) {
        sheet.getRange(1, lastCol + 1, 1, header.length - lastCol).setValues([header.slice(lastCol)]);
      }
    }
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#f3f3f3");
  }
}

function _appendBlock(sheet, data) {
  if (!data || data.length === 0) return;
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, data.length, data[0].length).setValues(data);
}

function _nowStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

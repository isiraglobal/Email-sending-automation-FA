# FOREIGN AFFAIRS — COMPLETE EMAIL AUTOMATION SYSTEM v7.0

## 📦 What You Have

Complete, production-ready email campaign automation with:

✅ **Gmail Integration** — Send emails with tracking pixels  
✅ **Cloudflare Tracking** — Log opens in D1 database  
✅ **Automatic Scheduling** — 9 AM sends, 2-hour syncs, 6 PM reports  
✅ **Zero Data Loss** — Full error handling, audit trails, deduplication  
✅ **Daily Reports** — Metrics saved to Google Drive  
✅ **Test Mode** — TEST_MODE flag for safe testing  

---

## 🚀 Quick Start (20 minutes)

### Step 1: Deploy Cloudflare Worker
1. Open Cloudflare Dashboard
2. Create new Worker, paste `Worker.js`
3. Add D1 binding: `database` = `emailsendingopenrate`
4. Create D1 table (SQL provided in `SETUP_COMPLETE.md`)
5. Deploy and note Worker URL: `https://emailsendingopenrate.isiraglobal.workers.dev`

### Step 2: Deploy Google Apps Script
1. Open Google Sheet → Extensions → Apps Script
2. Delete existing code
3. Paste `Code_Complete.gs`
4. Save as "Foreign Affairs Automation"
5. Run `setupGmailOAuth()` → click Allow in popup

### Step 3: Create Automatic Triggers
1. In Apps Script, click **Triggers** (clock icon)
2. Add 3 triggers:
   - `sendEmailBatch()` at 9:00 AM daily
   - `syncOpensFromCloudflare()` every 2 hours
   - `generateDailyReport()` at 6:00 PM daily

### Step 4: Test
1. Set `TEST_MODE = true` in Code.gs
2. Create "Test" sheet with 5 test rows
3. Run `sortSpreadsheetLeads()` → should import Test data
4. Run `sendEmailBatch("Sorted", 2)` → should send 2 test emails
5. Open email → pixel loads from Cloudflare
6. Run `syncOpensFromCloudflare("Sorted")` → should update open counts
7. Run `generateDailyReport()` → should create report in Drive

### Step 5: Go Live
1. Set `TEST_MODE = false`
2. Delete Test sheet
3. Load Apify data
4. Run `sortSpreadsheetLeads()` → should import from Apify
5. Automatic triggers now run on schedule

---

## 📄 Files Included

| File | Purpose |
|------|---------|
| `Worker.js` | Cloudflare Worker code (deploy to Cloudflare) |
| `Code_Complete.gs` | Google Apps Script (paste into Apps Script) |
| `SETUP_COMPLETE.md` | Step-by-step installation guide |
| `TRIGGER_CHART.md` | When to run each function (manual + automatic) |
| `OPERATIONS.md` | How data flows through the system |
| `README.md` | This file |

---

## 🔑 Key Variables

```javascript
const TEST_MODE = false;                    // Toggle test/production
const SECRET_KEY = "fa_open_track_2026_xK9mPqR";  // Cloudflare auth
const CLOUDFLARE_WORKER_URL = "https://emailsendingopenrate.isiraglobal.workers.dev";
const REPORT_FOLDER_ID = "1p9gPG_X45JPeP8w6TNu7XGcCc466nxKd";  // Drive folder
const THIS_SS_ID = "1DL7oreU6PnuCRl1MNYjmqKkU1h2JrWfiv2Zah2wi540";
```

---

## 🛠️ Main Functions

### Manual (Run On-Demand)
- `setupGmailOAuth()` — Authenticate with Gmail (run once)
- `sortSpreadsheetLeads()` — Import and deduplicate leads
- `sendEmailBatch(sheetName, limit)` — Send N emails
- `syncOpensFromCloudflare(sheetName)` — Fetch opens from Cloudflare
- `generateDailyReport()` — Create daily metrics report

### Automatic (Scheduled Triggers)
- 9:00 AM → `sendEmailBatch("Sorted", 50)` — Send 50 daily emails
- Every 2 hours → `syncOpensFromCloudflare("Sorted")` — Update open rates
- 6:00 PM → `generateDailyReport()` — Generate daily report

---

## 📊 Data Flow

```
Apify / Test Sheet
      ↓
sortSpreadsheetLeads() [deduplicate, validate]
      ↓
Sorted / Partial / Raw Sheets
      ↓
sendEmailBatch() [send with pixel URLs]
      ↓
Gmail API
      ↓
Emails with tracking pixels
      ↓
User opens email
      ↓
Pixel loads from Cloudflare Worker
      ↓
D1 Database logs open
      ↓
syncOpensFromCloudflare() [fetch opens]
      ↓
Update Sorted sheet: open_timestamp + open_count
      ↓
generateDailyReport() [calculate metrics]
      ↓
Google Drive: Daily report saved
```

---

## ✨ Features

### 1. Deduplication (3-Layer)
- Email match → BLOCKED
- Phone match (10+ digits) → BLOCKED  
- Name + City match → BLOCKED
- Zero duplicates reach your campaigns

### 2. Email Sending
- Gmail API integration
- Unique tracking pixel per lead
- Automatic `status="sent"` update
- Full error handling + logging

### 3. Open Tracking
- 1x1 transparent GIF pixel
- Logged in Cloudflare D1
- Includes: IP, country, user agent, timestamp
- Syncs back to Sorted sheet every 2 hours

### 4. Daily Reports
- Metrics: sent, opens, open rate, responses, bounces
- Saved to Google Drive
- One master document with daily entries
- Accessible via Drive link

### 5. Test Mode
- Set `TEST_MODE = true` to test safely
- Process ONLY Test sheet (Apify ignored)
- Test everything: sending, opens, reports
- Set `TEST_MODE = false` to go live

---

## 📋 Column Reference (Sorted Sheet)

| Col | Name | Contains | Updated By |
|-----|------|----------|------------|
| A | id | Auto-increment ID | sortSpreadsheetLeads |
| B | name | Venue name | sortSpreadsheetLeads |
| C | city | City | sortSpreadsheetLeads |
| D | address | Full address | sortSpreadsheetLeads |
| E | phone | Phone number | sortSpreadsheetLeads |
| F | email | Email address | sortSpreadsheetLeads |
| G | venue_type | Category/type | sortSpreadsheetLeads |
| H | capacity | Capacity | (manual) |
| I | pricing_range | Pricing | (manual) |
| J | description | Notes | (manual) |
| K | digital_footprint | **TRACKING PIXEL** | sortSpreadsheetLeads |
| L | target_audience | Audience | (manual) |
| M | source | "apify" or "test" | sortSpreadsheetLeads |
| N | status | "" / "sent" / "bounced" / "replied" | sendEmailBatch |
| O | variant | Campaign name | sendEmailBatch |
| P | sent_timestamp | When sent | sendEmailBatch |
| Q | notes | Admin notes | (manual) |
| R | open_timestamp | When first opened | syncOpensFromCloudflare |
| S | open_count | Number of opens | syncOpensFromCloudflare |

---

## 🔒 Security

✅ **SECRET_KEY** required for all Cloudflare API calls  
✅ **Gmail OAuth** — permissions required once  
✅ **D1 Database** — encrypted in transit  
✅ **Error Logging** — no sensitive data exposed  
✅ **Audit Trail** — all operations logged with timestamp  

---

## 📞 Support

If something breaks:
1. Check Apps Script **Execution log** for errors
2. Check Cloudflare Worker **Logs** for pixel issues
3. Check Google Drive **Activity** for report creation
4. Review `OPERATIONS.md` for data flow troubleshooting

---

## 🎯 Success Checklist

- [ ] Cloudflare Worker deployed
- [ ] D1 table created with correct schema
- [ ] Code.gs pasted into Apps Script
- [ ] `setupGmailOAuth()` run and authenticated
- [ ] 3 triggers created in Apps Script
- [ ] Test sheet created with 5 test rows
- [ ] `TEST_MODE = true` for testing
- [ ] `sortSpreadsheetLeads()` imported test data
- [ ] `sendEmailBatch()` sent test emails
- [ ] Test emails received with pixels
- [ ] `syncOpensFromCloudflare()` updated opens
- [ ] `generateDailyReport()` created report doc
- [ ] `TEST_MODE = false` for production
- [ ] Apify data loaded
- [ ] Automatic triggers running on schedule

Once all checkboxes are done, system is fully operational! 🚀

---

## 📖 Next Steps

1. Read `SETUP_COMPLETE.md` for detailed setup instructions
2. Read `TRIGGER_CHART.md` to understand when functions run
3. Read `OPERATIONS.md` to see how data flows
4. Start with TEST_MODE=true to verify everything works
5. Switch to TEST_MODE=false for production

---

## Questions?

Refer to:
- `SETUP_COMPLETE.md` — Installation help
- `TRIGGER_CHART.md` — Function scheduling
- `OPERATIONS.md` — System architecture
- Apps Script **Execution log** — Real-time debugging
- Cloudflare **Logs** — Worker diagnostics

---

**System is production-ready. No data loss. Full automation. Zero human intervention needed once triggers are set.** ✅

Good luck! 🎉

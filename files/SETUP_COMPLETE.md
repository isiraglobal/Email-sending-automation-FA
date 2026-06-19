# FOREIGN AFFAIRS — COMPLETE SETUP GUIDE v7.1

## Part 1: Cloudflare Worker Setup (5 minutes)

### 1.1 Deploy Worker
1. Go to **Cloudflare Dashboard** → **Workers**
2. Create new Worker → paste `Worker.js` code
3. Deploy

### 1.2 Create D1 Database
1. In Cloudflare Dashboard → **D1**
2. Create database: name = `emailsendingopenrate`
3. Get the database ID (you have: `1ee29b39-8e80-4158-a285-7120a2484895`)
4. In Worker settings, add binding:
   - Name: `database`
   - Database: `emailsendingopenrate`

### 1.3 Create D1 Table
Run this SQL in D1 console:
```sql
CREATE TABLE email_opens (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id   TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  user_agent TEXT,
  ip        TEXT,
  country   TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lead_id ON email_opens(lead_id);
CREATE INDEX idx_opened_at ON email_opens(opened_at);
```

### 1.4 Get Worker URL
Your Worker URL: `https://emailsendingopenrate.isiraglobal.workers.dev`

This is already in Code.gs, no changes needed.

---

## Part 2: Google Apps Script Setup (10 minutes)

### 2.1 Copy Code
1. Open your Google Sheet
2. **Extensions** → **Apps Script**
3. Delete any existing code
4. Paste entire `Code_Complete.gs`
5. Save project as "Foreign Affairs Automation"

### 2.2 Configure Constants (if needed)
At the top of Code.gs:
```javascript
const TEST_MODE = false;  // Set to true for testing
const SECRET_KEY = "fa_open_track_2026_xK9mPqR";  // Already correct
const CLOUDFLARE_WORKER_URL = "https://emailsendingopenrate.isiraglobal.workers.dev";  // Already correct
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1512500880027418634/...";  // Already correct
const REPORT_FOLDER_ID = "1p9gPG_X45JPeP8w6TNu7XGcCc466nxKd";  // Already correct
```

### 2.3 Authorize Gmail
1. In Apps Script, run: **`setupGmailOAuth()`**
2. You'll see a popup asking for Gmail permission
3. Click **Allow**
4. You'll see: `Gmail authenticated as: your@email.com`

---

## Part 3: Create Sheets (2 minutes)

Make sure these sheets exist in your spreadsheet:
- ✅ `Apify` (data source)
- ✅ `Test` (for testing, can be empty if TEST_MODE=false)
- ✅ `Sorted` (output, auto-created if missing)
- ✅ `Partial` (output, auto-created if missing)
- ✅ `Raw` (output, auto-created if missing)

---

## Part 4: Set Up Automatic Triggers (5 minutes)

In Apps Script, go to **Triggers** (clock icon on left)

### Create these triggers:

**Trigger 1: Send One Email Every 5 Minutes**
- Function: `sendNextEmail`
- Type: Time-based
- Frequency: Minutes timer
- Interval: **Every 5 minutes**
- Executes: sends 1 email every 5 minutes (~288/day)

**Trigger 2: Sync Opens (Every 1 Hour)**
- Function: `syncOpensFromCloudflare`
- Type: Time-based
- Frequency: Hours
- Interval: **Every 1 hour**
- Executes: batch-updates open_timestamp + open_count

**Trigger 3: Daily Report (6 PM)**
- Function: `generateDailyReport`
- Type: Time-based
- Frequency: Day
- Time: **6:00 PM to 7:00 PM**
- Executes: creates daily metrics report

**Trigger 4: Reply Check (Every 12 Hours)**
- Function: `checkAndNotifyReplies`
- Type: Time-based
- Frequency: Hours
- Interval: **Every 12 hours**
- Executes: checks for replies → sends to Discord → WhatsApp

---

## Part 5: Test (5 minutes)

### 5.1 Enable Test Mode
In Code.gs, change:
```javascript
const TEST_MODE = true;
```

### 5.2 Create Test Data
Run: **`createTestData()`** in the Apps Script console
- Creates the "Test" sheet with 10 realistic sample leads
- Includes proper headers matching the Apify column format
- Auto-populates name, venue, city, phone, email, website, category
- **Replace the sample emails** with your own test email addresses before sending

### 5.3 Run Test
1. Run: **`sortSpreadsheetLeads()`**
   - Should process Test sheet only
   - See data in Sorted sheet (website URLs stored, NOT pixel URLs)

2. Run: **`sendNextEmail()`**
   - Should send 1 test email with randomized content
   - You'll receive it
   - Check for pixel in email source (no detectable comments)
   - Run again to send another

3. Open the email in your client
   - Pixel request goes to Cloudflare
   - Check Cloudflare logs

4. Run: **`syncOpensFromCloudflare("Sorted")`**
   - Should batch-update open_timestamp + open_count

5. Run: **`checkAndNotifyReplies()`**
   - Reply to the test email in Gmail
   - Run checkAndNotifyReplies()
   - Verify Discord notification appears

6. Run: **`generateDailyReport()`**
   - Should create/append to report document in Drive folder

### 5.4 Disable Test Mode
When testing is done:
```javascript
const TEST_MODE = false;
```

---

## Part 6: Go Live

1. Ensure Apify sheet has real data
2. Set `TEST_MODE = false`
3. Run: **`sortSpreadsheetLeads()`**
   - Should process Apify data
   - Stores website URLs, NOT pixel URLs

4. Automatic triggers now run:
   - Every 5 minutes: Send 1 email
   - Every 1 hour: Sync opens
   - Every 12 hours: Check replies → Discord → WhatsApp
   - 6 PM: Generate report

---

## Troubleshooting

### Error: "Cloudflare returned 403"
- Check SECRET_KEY is correct: `fa_open_track_2026_xK9mPqR`
- Check Worker URL is correct

### Error: "Gmail authenticated failed"
- Click **Allow** when prompted for Gmail permission
- Run `setupGmailOAuth()` again

### Pixels not tracking
- Check pixel URL in email source: should contain `lead-` + ID
- Check Cloudflare Worker logs
- Verify D1 table was created
- Pixel is an inline img, not an attachment — verify in email source

### Discord notifications not sending
- Check DISCORD_WEBHOOK_URL is correct
- Check Discord channel still has the webhook active
- Run `checkAndNotifyReplies()` manually and check logs

### Report not generating
- Check Drive folder ID: `1p9gPG_X45JPeP8w6TNu7XGcCc466nxKd`
- Check folder exists and you have write access

---

## File References

- **Worker Code**: `Worker.js` (deploy to Cloudflare)
- **Google Script**: `Code_Complete.gs` (paste into Apps Script)
- **Setup Guide**: This file
- **Trigger Chart**: `TRIGGER_CHART.md`
- **Operations**: `OPERATIONS.md`

---

## Key Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| TEST_MODE | false | Toggle test/production |
| SECRET_KEY | fa_open_track_2026_xK9mPqR | Cloudflare authentication |
| CLOUDFLARE_WORKER_URL | https://emailsendingopenrate.isiraglobal.workers.dev | Pixel endpoint |
| DISCORD_WEBHOOK_URL | (your webhook URL) | Reply notifications → WhatsApp |
| REPORT_FOLDER_ID | 1p9gPG_X45JPeP8w6TNu7XGcCc466nxKd | Google Drive reports |
| THIS_SS_ID | 1DL7oreU6PnuCRl1MNYjmqKkU1h2JrWfiv2Zah2wi540 | Spreadsheet ID |

---

## Success Indicators

- ✅ Cloudflare Worker deployed and accessible
- ✅ D1 table created and functional
- ✅ Gmail authentication working
- ✅ Test emails sending (1 every 5 min)
- ✅ Randomized subject + body content working
- ✅ Pixels being logged in Cloudflare (no detectable comments)
- ✅ Open rates batch-updating in Sorted sheet
- ✅ Reply detection → Discord notifications working
- ✅ Daily reports generating in Google Drive
- ✅ All 4 automatic triggers scheduled

Once all are green, you're live!

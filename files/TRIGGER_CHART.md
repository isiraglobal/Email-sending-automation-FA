# TRIGGER CHART — When to Run Each Function

## Manual Functions (Run On-Demand)

### 1. setupGmailOAuth()
**When**: Once, when you first set up
**Purpose**: Authenticate with Gmail
**Output**: Gmail authenticated as: your@email.com
**How to run**:
- In Apps Script, click **Run** → `setupGmailOAuth`

### 2. createTestData()
**When**: Once, when setting up TEST_MODE for the first time
**Purpose**: Populates the "Test" sheet with 10 realistic sample leads
**Output**: Test sheet created with headers + 10 rows of sample data
**Note**: Replace sample emails with your own test addresses before sending
**How to run**:
```javascript
createTestData();
```

### 3. sortSpreadsheetLeads()
**When**: After loading new data into Apify or Test sheet
**Purpose**: Import leads, deduplicate, store website URLs in digital_footprint
**Input**: Apify tab or Test tab (depending on TEST_MODE)
**Output**: Sorted, Partial, Raw sheets updated
**How to run**:
```javascript
sortSpreadsheetLeads()
```

### 4. sendNextEmail()
**When**: Manually test sending one email
**Purpose**: Sends ONE email to the next unsent lead
**Behavior**:
- TEST_MODE=true → reads from "Test" sheet
- TEST_MODE=false → reads from "Sorted" sheet
**How to run**:
```javascript
sendNextEmail();
```

### 5. syncOpensFromCloudflare()
**When**: Manually check for new opens
**Purpose**: Fetch opens from Cloudflare, batch-update sheet
**Input**: Cloudflare D1 database
**Output**: open_timestamp + open_count columns batch-updated
**How to run**:
```javascript
syncOpensFromCloudflare("Sorted");
```

### 6. generateDailyReport()
**When**: Manually generate report
**Purpose**: Create daily stats document
**Output**: New document in Drive folder (or appended to existing)
**How to run**:
```javascript
generateDailyReport();
```

### 7. checkAndNotifyReplies()
**When**: Manually check for replies
**Purpose**: Search Gmail inbox for replies → send Discord webhook → WhatsApp
**How to run**:
```javascript
checkAndNotifyReplies();
```

---

## Automatic Triggers (Scheduled)

These run automatically once set up in Apps Script Triggers.

### Trigger 1: Send ONE Email Every 5 Minutes
```
Function: sendNextEmail
Schedule: Every 5 minutes (time-driven)
Parameters: none
Action: Sends exactly 1 email to the next unsent lead
Result: status → "sent", sent_timestamp → current time, variant → "vX.Y.Z"
Rate: 12 emails/hour, ~288/day (within Gmail daily limit)
```

### Trigger 2: Open Rate Sync
```
Function: syncOpensFromCloudflare
Schedule: Every 1 hour
Parameters: none (auto-detects sheet from TEST_MODE)
Action: Fetches latest opens from Cloudflare, batch-updates sheet
Result: open_timestamp + open_count batch-updated
```

### Trigger 3: Evening Report
```
Function: generateDailyReport
Schedule: Daily at 6:00 PM
Parameters: none
Action: Creates daily metrics report
Result: New entry in Drive report document
```

### Trigger 4: Reply Check → Discord Webhook
```
Function: checkAndNotifyReplies
Schedule: Every 12 hours (twice daily, e.g., 9 AM and 9 PM)
Parameters: none
Action: Searches Gmail for replies to campaign emails
Result: Sends notification to Discord webhook → WhatsApp community
```

---

## Daily Workflow Example

```
EVERY 5 MINUTES
├─ Trigger: sendNextEmail()
├─ Action: Sends 1 email to next unsent lead
├─ Randomized: subject + body intro + body closing (6 variants each)
├─ Pixel URL generated at send-time
├─ Update: status="sent", sent_timestamp, variant="v3.2.5"
└─ Next run: 5 minutes later

EVERY 1 HOUR
├─ Trigger: syncOpensFromCloudflare()
├─ Fetches all opens from Cloudflare
├─ Batch-updates open_timestamp + open_count
└─ Tracks last_sync_time for future optimization

TWICE DAILY (9 AM & 9 PM)
├─ Trigger: checkAndNotifyReplies()
├─ Searches Gmail for "Re:" replies to campaign subjects
├─ Matches reply sender to sent leads
├─ Sends Discord embed with: name, email, reply preview, timestamp
└─ Marks lead status = "replied" in sheet

DAILY AT 6 PM
├─ Trigger: generateDailyReport()
├─ Calculates: total sent, sent today, opens, open rate, replies, bounces, failed
├─ Tracks which variant combinations performed best
└─ Appends to master report document in Drive
```

---

## Testing Triggers

### Test Setup (TEST_MODE = true)
```
Manual: createTestData()
├─ Creates/overwrites Test sheet
├─ 10 realistic sample leads with emails, phones, websites
└─ Replace sample emails with your own test addresses

Manual: sortSpreadsheetLeads()
├─ Processes only Test sheet
├─ Imports and deduplicates test leads into Sorted
└─ Stores website URLs (not pixel URLs)

Manual: sendNextEmail()
├─ Sends 1 test email
├─ You receive it with tracking pixel
└─ Check randomized subject + body

Manual: syncOpensFromCloudflare("Sorted")
├─ Fetches opens from Cloudflare
├─ Batch-updates open_timestamp + open_count
└─ Verify in Sorted sheet

Manual: generateDailyReport()
├─ Creates test report
└─ Verify in Drive folder

Manual: checkAndNotifyReplies()
├─ Reply to the test email in Gmail
├─ Run checkAndNotifyReplies()
└─ Verify Discord notification appears
```

---

## Trigger Configuration (Apps Script)

Go to **Triggers** → **Create new trigger**

### Trigger 1: Every 5 Minutes
- Choose function: **sendNextEmail**
- Choose deployment: **Head**
- Select event source: **Time-driven**
- Select type of time-based trigger: **Minutes timer**
- Select minute interval: **Every 5 minutes**
- Click **Save**

### Trigger 2: Every 1 Hour
- Choose function: **syncOpensFromCloudflare**
- Choose deployment: **Head**
- Select event source: **Time-driven**
- Select type of time-based trigger: **Hours**
- Select interval: **Every 1 hour**
- Click **Save**

### Trigger 3: Daily at 6 PM
- Choose function: **generateDailyReport**
- Choose deployment: **Head**
- Select event source: **Time-driven**
- Select type of time-based trigger: **Day**
- Select time of day: **6:00 PM to 7:00 PM**
- Click **Save**

### Trigger 4: Every 12 Hours (Twice Daily)
- Choose function: **checkAndNotifyReplies**
- Choose deployment: **Head**
- Select event source: **Time-driven**
- Select type of time-based trigger: **Hours**
- Select interval: **Every 12 hours**
- Click **Save**

---

## Error Handling & Logging

All functions log to Apps Script console:
- Click **Execution log** to see real-time logs
- Logs show: success, errors, timestamps
- If trigger fails, you get email notification

Example logs:
```
[09:00:01] TEST_MODE=false — reading from Sorted sheet
[09:00:02] Sent to: john@example.com | variant=v3.1.4
[09:00:02] Next send: +5 minutes
[09:05:01] Sent to: jane@example.com | variant=v1.5.2
[09:10:01] Send failed (retry 1/3): bad@example.com | Invalid email
[09:15:01] Sent to: bob@example.com | variant=v4.2.1
```

---

## Key Takeaways

| Task | When | How |
|------|------|------|
| Import data | After loading to Apify | Manual: `sortSpreadsheetLeads()` |
| Send emails | Every 5 minutes | Automatic: 5-min trigger |
| Track opens | Continuous | Automatic: Every 1 hour sync |
| Check replies | Twice daily | Automatic: Every 12 hours |
| Generate reports | Every evening | Automatic: 6 PM trigger |
| Test everything | During setup | Manual: set TEST_MODE=true |

Once triggers are set, the system runs on autopilot!

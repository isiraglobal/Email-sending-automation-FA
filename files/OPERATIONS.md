# OPERATIONS — How Data Flows Through the System

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FOREIGN AFFAIRS v7.1                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. DATA INPUT                                                           │
│     ├─ Apify Sheet (production data)                                    │
│     └─ Test Sheet (test data, if TEST_MODE=true)                        │
│                                                                           │
│  2. GOOGLE APPS SCRIPT                                                  │
│     ├─ sortSpreadsheetLeads()          → deduplicates, validates        │
│     ├─ sendNextEmail()                 → sends 1 email every 5 min     │
│     ├─ syncOpensFromCloudflare()       → batch-fetches tracking data    │
│     ├─ generateDailyReport()           → creates metrics report         │
│     └─ checkAndNotifyReplies()         → Discord webhook for replies    │
│                                                                           │
│  3. GMAIL API                                                            │
│     ├─ Sends emails with embedded pixels (generated at send-time)       │
│     └─ Updates sent_timestamp on success                                │
│                                                                           │
│  4. CLOUDFLARE WORKER                                                   │
│     ├─ /pixel endpoint → logs opens, returns 1x1 transparent GIF       │
│     ├─ /api/opens → retrieves opens for admin                           │
│     ├─ /api/webhook → receives external event notifications             │
│     └─ D1 Database → stores { lead_id, opened_at, ip, country }         │
│                                                                           │
│  5. DISCORD WEBHOOK                                                      │
│     ├─ Receives reply notifications from checkAndNotifyReplies()        │
│     └─ Forwards to WhatsApp community                                   │
│                                                                           │
│  6. OUTPUTS                                                              │
│     ├─ Sorted Sheet   (email+phone ready leads, status tracking)        │
│     ├─ Partial Sheet  (phone-only leads)                                │
│     ├─ Raw Sheet      (archive)                                         │
│     └─ Google Drive   (daily reports)                                   │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow #1: Import & Deduplication

```
Apify Tab
    │
    ├─ Read rows
    ├─ Normalize city, email, phone, name
    └─ Check against 3-layer dedupe:
       ├─ Email already sent? → SKIP
       ├─ Phone already sent? → SKIP
       ├─ Name+City already sent? → SKIP
       └─ Clean? → PROCESS
            │
            ├─ Store WEBSITE URL in digital_footprint column
            │  (NOT pixel URL — pixel is generated at send-time)
            │
            └─ Route to:
               ├─ Sorted (has email + phone)
               ├─ Partial (has phone only)
               └─ Raw (archive everything)

Sorted Sheet
    ├─ ID: auto-increment (based on MAX existing ID)
    ├─ Name, City, Address, Phone, Email (from source)
    ├─ Digital Footprint: WEBSITE URL (e.g., https://venuelounge.com)
    ├─ Source: "apify" or "test"
    ├─ Status: "" (empty = not sent)
    └─ Other fields: empty until sent
```

---

## Data Flow #2: Email Sending (One Every 5 Minutes)

```
Sorted Sheet (status = "")
    │
    └─ sendNextEmail() triggers every 5 minutes
       │
       ├─ Read TEST_MODE:
       │  ├─ true  → use "Test" sheet
       │  └─ false → use "Sorted" sheet
       │
       ├─ Find first unsent lead (status != "sent" & != "failed")
       │
       ├─ Generate pixel URL at send-time:
       │  https://worker.dev/pixel?id=lead-42&e=john%40ex.com&t=2026-01-20T09:00:00Z
       │
       ├─ Build randomized email:
       │  ├─ Pick 1 of 6 subjects (random)
       │  ├─ Pick 1 of 6 body intros (random, with {name}/{city} filled)
       │  ├─ Pick 1 of 6 body closings (random, with {phone} filled)
       │  └─ Embed pixel: <img src="..." width=1 height=1 style="display:none" />
       │
       ├─ Send via Gmail API
       │
       └─ On success:
          ├─ status → "sent"
          ├─ sent_timestamp → "2026-01-20 09:00:01"
          ├─ variant → "v3.2.1" (tracks which subject/intro/closing used)
          └─ Log: "Sent to: john@example.com | variant=v3.2.1"

Sorted Sheet (updated)
    ├─ Row 1: status="sent", sent_timestamp="2026-01-20 09:00:01", variant="v3.2.1"
    ├─ Row 2: status="sent", sent_timestamp="2026-01-20 09:05:01", variant="v1.5.4"
    └─ Row 3: status="" (waiting for next 5-min cycle)

Retry Logic:
    ├─ On failure: notes column → "retry:1 | error message"
    ├─ Max 3 retries
    └─ After 3 failures: status → "failed"
```

---

## Data Flow #3: Email Open Tracking

```
User's Email Client
    │
    ├─ Email received with pixel (no detectable comments in HTML)
    │  <img src="https://worker.dev/pixel?id=lead-42&e=john%40ex.com" />
    │
    └─ User opens email
       │
       └─ Browser requests 1x1 transparent GIF from Cloudflare Worker
          │
          ├─ Worker logs to D1:
          │  lead_id: lead-42
          │  opened_at: 2026-01-20T11:30:00Z
          │  user_agent: Mozilla/5.0...
          │  ip: 192.168.1.100
          │  country: US
          │
          └─ Returns: 1x1 transparent GIF (43 bytes, no attachment)

D1 Database
    ├─ Row 1: lead-42, 2026-01-20 11:30:00, Mozilla..., 192.168.1.100, US
    ├─ Row 2: lead-42, 2026-01-20 14:22:15, Mozilla..., 192.168.1.100, US (re-open)
    └─ Row 3: lead-43, 2026-01-20 11:35:00, Safari..., 203.0.113.0, CA

Key: Pixel is an inline <img> tag, NOT an attachment. 
     User cannot detect or block it without blocking all images.
     No <!-- comments --> in HTML that could reveal the tracking.
```

---

## Data Flow #4: Open Rate Sync (Batch-Optimized)

```
Sync Trigger (Every 1 hour)
    │
    └─ syncOpensFromCloudflare() runs
       │
       ├─ Query Cloudflare API:
       │  GET /api/opens/all?key=fa_open_track_2026_xK9mPqR
       │
       ├─ Response grouped by lead_id:
       │  { "lead-42": [ { opened_at, ... }, ... ], ... }
       │
       ├─ Read full Sorted sheet into memory
       │
       ├─ Build update arrays:
       │  ├─ open_timestamp column → batch of values
       │  └─ open_count column → batch of values
       │
       └─ Write both columns with single setValues() calls
          ├─ 1 API call for all timestamps
          ├─ 1 API call for all counts
          └─ Fast: 500 rows updated in ~2 seconds

Properties:
    ├─ LAST_OPEN_SYNC → stored in Script Properties
    └─ Used for future incremental syncs
```

---

## Data Flow #5: Reply Detection → Discord → WhatsApp

```
Reply Check Trigger (Every 12 hours — 9 AM & 9 PM)
    │
    └─ checkAndNotifyReplies() runs
       │
       ├─ Read Sorted sheet to find all sent leads and their emails
       │
       ├─ Search Gmail inbox:
       │  in:inbox subject:Re: (Exclusive Opportunity OR Your Venue OR ...)
       │  after: [last_check_date]
       │
       ├─ For each reply found:
       │  ├─ Extract: from, subject, date, body snippet
       │  ├─ Match sender email to sent leads list
       │  └─ If matched:
       │     ├─ Build Discord embed:
       │     │  {
       │     │    "embeds": [{
       │     │      "title": "New Reply from Lead",
       │     │      "fields": [
       │     │        { "name": "Name", "value": "John Smith" },
       │     │        { "name": "Email", "value": "john@example.com" },
       │     │        { "name": "Reply Preview", "value": "Hi, I'm interested..." }
       │     │      ]
       │     │    }]
       │     │  }
       │     ├─ POST to Discord webhook URL
       │     ├─ Discord forwards to connected WhatsApp community
       │     └─ Mark lead status = "replied" in sheet
       │
       └─ Store LAST_REPLY_CHECK timestamp

Marked in sheet:
    ├─ status → "replied"
    ├─ notes → "[Replied: 2026-01-20T15:30:00Z]"
    └─ Log: "Discord notification sent for reply from: john@example.com"
```

---

## Data Flow #6: Daily Report Generation

```
Report Trigger (6:00 PM daily)
    │
    └─ generateDailyReport() runs
       │
       ├─ Read sheet (respects TEST_MODE)
       │
       ├─ Calculate metrics:
       │  ├─ Total leads / Total sent / Sent today
       │  ├─ Opens / Open rate
       │  ├─ Replies / Response rate
       │  ├─ Bounces / Failed
       │  └─ Variant breakdown (which combos performed best)
       │
       ├─ Build report
       │
       └─ Append to master document in Drive folder
```

---

## Database Schema (D1)

```
Table: email_opens

Column         Type      Purpose
─────────────────────────────────────────────────
id             INTEGER   Auto-increment primary key
lead_id        TEXT      Unique lead identifier (lead-42)
opened_at      TEXT      ISO timestamp of open
user_agent     TEXT      Browser/client info
ip             TEXT      IP address of opener
country        TEXT      Country code (US, CA, UK)
created_at     TEXT      When record created (DEFAULT CURRENT_TIMESTAMP)
```

---

## Key Changes from v7.0

| Aspect | v7.0 (Old) | v7.1 (New) |
|--------|------------|------------|
| Email sending | 50 at once daily | **1 every 5 minutes** |
| Email content | Static template | **Randomized: 6 subjects × 6 intros × 6 closings** |
| Signature | One hardcoded | **6 closing variants with same "Foreign Affairs Team" name** |
| Pixel URL | Generated at import, stored in sheet | **Generated at send-time, in-memory only** |
| digital_footprint | Stored pixel URL | **Stores business website URL** |
| Open sync | Row-by-row setValue() | **Batch setValues() — 100x faster** |
| Reply handling | Not tracked | **Detected → Discord webhook → WhatsApp** |
| Retry logic | None | **3 retries, then status="failed"** |
| ID generation | getLastRow() | **MAX(id) — safe even after row deletion** |
| Lock timeout | 30 seconds | **60 seconds for imports** |

---

## Error Handling & Recovery

### Email Send Failure
```
Error: Gmail API timeout / Invalid email
Action: 
  - Log error with timestamp
  - Increment retry in notes column
  - After 3 retries: status = "failed"
  - Next unsent lead picked next 5-min cycle
```

### Cloudflare Down
```
Error: /api/opens endpoint returns 500
Action:
  - Log error
  - Skip sync (don't lose data)
  - Retry automatically in 1 hour
  - Data safe in D1, will be fetched when service restored
```

### Discord Webhook Failure
```
Error: Discord endpoint unreachable
Action:
  - Log error
  - Reply still marked in sheet
  - Manual retry possible
```

### Concurrent Execution
```
If sendNextEmail() is already running when trigger fires again:
  - LockService.tryLock() fails → skip silently
  - No double-sends, no data corruption
```

---

## Data Safety Guarantees

- **No Data Loss**: All imports logged in Raw sheet, duplicates caught before any operation
- **Full Audit Trail**: Every action timestamped, all logs viewable in Apps Script console
- **Idempotent Operations**: Running same function twice = same result
- **No Double Sends**: status="sent" checked first, LockService prevents concurrent sends
- **Privacy Protected**: SECRET_KEY required for all Cloudflare API calls
- **Pixel Undetectable**: No comments in HTML, true 1x1 transparent GIF, no attachments

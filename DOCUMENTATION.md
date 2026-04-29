# Overview

Automated workflow that sends a weekly Slack message every Friday at 10:30 AM IST summarizing:

- Posts published this week (LinkedIn only)
- Posts still in queue for rest of this week
- Posts scheduled for next week

**Status:** ✅ Working and deployed

**GitHub Repository:** `buffer-slack-workflow`

---

# The Challenge: Buffer API Limitation

Buffer's GraphQL API has a critical limitation:

- ✅ The `sentAt` field exists on Post objects (when a post was published)
- ❌ But `sentAt` **cannot be used as a filter** in API queries
- ✅ We can only filter by `createdAt` and `dueAt`

This is documented in the Buffer API reference:

- `PostsFiltersInput` has fields: `channelIds`, `status`, `tags`, `dueAt`, `createdAt`
- `PostSortableKey` enum has values: `dueAt`, `createdAt`
- **No `sentAt` filtering or sorting available**

---

# The Solution: Hybrid Approach

Since we can't filter by `sentAt` in the API, we use a **hybrid approach**:

## Three-Section Message Structure

**Section 1: Posts sent this week**

- Fetch last 20 published posts (status: `sent`, sorted by `createdAt` desc)
- Filter **client-side** in JavaScript by checking `sentAt` field
- Show only posts where `sentAt` falls within Monday-Sunday of current week
- Include posting goal stats if available

**Section 2: Posts in queue for rest of this week**

- Fetch scheduled posts (status: `scheduled` or `sending`)
- Filter by `dueAt` from NOW until end of Sunday
- Shows what's still scheduled to go out before the week ends

**Section 3: Posts in queue for next week**

- Fetch scheduled posts (status: `scheduled` or `sending`)
- Filter by `dueAt` for next Monday-Sunday

---

# Output Specification

The message uses Slack Block Kit format with mrkdwn text sections.

## Variant 1: Posts sent + queue this week + queue next week

```
Hi Shivani! Here's what you posted on LinkedIn this week.

Goal: 4 posts/week · Sent: 2 · Scheduled: 3 · OnTrack 👌

Monday, Mar 17, 2026: Just shipped a major feature update...
Wednesday, Mar 19, 2026: Sometimes the best content strategy...

---

Here's what's in queue for the rest of this week:

Saturday, Mar 22, 2026: Weekend productivity thoughts...

---

Here's what's scheduled for next week:

Monday, Mar 24, 2026: New week kickoff post...
```

## Variant 2: Nothing sent + queue this week + queue next week

```
Hi Shivani! You haven't posted anything on LinkedIn this week 😔

---

Here's what's in queue for the rest of this week:

Saturday, Mar 22, 2026: Weekend productivity thoughts...

---

Here's what's scheduled for next week:

Monday, Mar 24, 2026: New week kickoff post...
```

## Variant 3: Posts sent + empty queue this week + empty queue next week

```
Hi Shivani! Here's what you posted on LinkedIn this week.

Goal: 4 posts/week · Sent: 2 · Scheduled: 1 · OnTrack 👌

Monday, Mar 17, 2026: Post text...

---

There's nothing scheduled for the rest of this week.

---

Your queue for next week is empty right now. Head over to your <Create Space link> for inspiration ✨
```

## Variant 4: Nothing sent + empty queues

```
Hi Shivani! You haven't posted anything on LinkedIn this week 😔

---

There's nothing scheduled for the rest of this week.

Your streak is at risk! Explore your <Create Space|idea bank> and schedule something to stay on track.

---

Your queue for next week is empty right now. Head over to your <Create Space|Create Space> for inspiration ✨
```

## Variant 5: Nothing sent + empty queue this week + queue next week

```
Hi Shivani! You haven't posted anything on LinkedIn this week 😔

---

There's nothing scheduled for the rest of this week.

Your streak is at risk! Explore your <Create Space|idea bank> and schedule something to stay on track.

---

Here's what's scheduled for next week:

Monday, Mar 24, 2026: New week kickoff post...
```

## Formatting Rules

- **Block Kit format:** Messages are sent as Slack Block Kit blocks, not plain text
- **Text sections:** Use mrkdwn for formatting within blocks
- **Bold text:** Single asterisks `*text*` for Bold in mrkdwn
- **Links:** `<URL|link text>` format for Slack links
- **Post text:** Truncated to first sentence ending (`.`, `!`, or `?`), or 100 characters max
- **Scheduled status:** Add `(scheduled)` suffix after date if status is `sending`
- **Goal stats:** If available, display posting goal with emoji: ✅ Hit, 👌 OnTrack, ⚠️ AtRisk
- **Links:**
    - Post dates link to: `https://publish.buffer.com/schedule/calendar/month/posts/{POST_ID}`
    - Create Space: `https://publish.buffer.com/create/ideas?view=board`

---

# Configuration

## Buffer Settings

- **Organization ID:** `5aebdfa719520549010a5230`
- **Platform naming:** Uses `channel.descriptor` (returns platform-specific names)
- **Allowed channels:** Configured in `ALLOWED_CHANNELS` array (currently: `['linkedin']`)
- **Query limit:** Fetches up to 20 published posts, up to 100 scheduled posts per date range

## Time Settings

- **Timezone:** IST (`Asia/Kolkata`) - UTC+5:30
- **Week boundaries:** Monday 00:00 IST → Sunday 23:59 IST
- **Run schedule:** Every Friday at 10:30 AM IST
- **GitHub Actions cron:** `0 5 * * 5` (05:00 UTC = 10:30 IST)

## Post Filtering

- **Published posts:** Fetch last 20 (sorted by `createdAt` desc), filter client-side by `sentAt`
- **Scheduled posts:** Query by `dueAt` range, sorted by `dueAt` ascending
- **Channel filtering:** Only include posts from channels in `ALLOWED_CHANNELS`
- **Excluded statuses:** `error` posts are automatically excluded by status filter
- **Justification for "20":** User sends ~10 posts/week max, so 20 covers this week + buffer

---

# Technical Implementation

## Project Structure

```
buffer-slack-workflow/
├── .github/workflows/weekly-summary.yml
├── src/
│   ├── config.js
│   └── fetchPosts.js
├── .env.example
├── .gitignore
└── package.json
```

## Key Files

### package.json

```json
{
  "name": "buffer-slack-workflow",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node src/fetchPosts.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "node-fetch": "^3.3.2"
  }
}
```

### src/config.js

```javascript
export const CONFIG = {
  TIMEZONE: 'Asia/Kolkata',
  WEEK_START_DAY: 1,
  BUFFER_API_URL: 'https://api.buffer.com',
  POST_TEXT_MAX_LENGTH: 100,
  DATE_FORMAT: {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  },
  CREATE_SPACE_URL: 'https://publish.buffer.com/create/ideas?view=board',
  ALLOWED_CHANNELS: ['linkedin']
};
```

### .github/workflows/weekly-summary.yml

```yaml
name: Weekly Buffer Summary
on:
  schedule:
    - cron: '0 5 * * 5'  # 10:30 IST = 05:00 UTC
  workflow_dispatch:
jobs:
  send-summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Run weekly summary script
        env:
          BUFFER_API_TOKEN: ${{ secrets.BUFFER_API_TOKEN }}
          BUFFER_ORG_ID: ${{ secrets.BUFFER_ORG_ID }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: npm test
```

## GitHub Secrets Required

- `BUFFER_API_TOKEN` - Buffer API access token
- `BUFFER_ORG_ID` - `5aebdfa719520549010a5230`
- `SLACK_WEBHOOK_URL` - Slack incoming webhook URL

---

# Critical Implementation Details

## Timezone Handling

Uses actual UTC time (`now`) for "rest of this week" boundary instead of IST-converted time. This ensures posts scheduled for any time from NOW until end of Sunday are captured correctly.

```javascript
const restOfWeekStart = new Date(now); // Use UTC now, not nowIST
const restOfWeekEnd = new Date(thisWeekEnd);
```

This prevents the bug where posts scheduled for later today would be missed if using IST-converted time.

## Week Boundary Calculation

1. Get current time in IST via locale conversion
2. Calculate Monday of current week (subtracting days since Monday)
3. Generate ISO 8601 boundaries for:
   - Full this week (Mon 00:00 to Sun 23:59)
   - Rest of this week (NOW to Sun 23:59)
   - Full next week (Mon 00:00 to Sun 23:59)

## Text Truncation

Posts are truncated intelligently:
- **Primary method:** Find first sentence-ending punctuation (`.`, `!`, or `?`)
- **Fallback method:** If no sentence ending, truncate to 100 characters and append `...`

## Slack Block Kit Format

Messages are sent as Block Kit blocks:
- `type: 'section'` blocks for text content
- `type: 'divider'` blocks between sections
- All text uses `mrkdwn` format for formatting support

## Posting Goal Display

If a posted channel has a posting goal, the script displays:
- Goal target (e.g., "4 posts/week")
- Sent count this week
- Scheduled count
- Status with emoji (✅ Hit, 👌 OnTrack, ⚠️ AtRisk)

---

# Slack Formatting

## Why icon_emoji and username Don't Work

Modern Slack webhooks created through Slack apps **cannot** override username or icon via API parameters. These settings are controlled by the Slack app configuration.

**To customize the icon and name:**

1. Go to https://api.slack.com/apps
2. Click your app
3. Navigate to **Settings → Basic Information**
4. Update **App Icon** and **App Name**

## Slack mrkdwn Format

Slack uses its own markdown format called "mrkdwn":

- **Bold:** `*text*` (single asterisks, NOT double)
- **Links:** `<URL|link text>`
- **Bold links:** `*<URL|link text>*`

**Standard Markdown does NOT work in Slack webhooks.**

---

# Buffer API Details

## GraphQL Endpoint

- **URL:** `https://api.buffer.com`
- **Method:** POST
- **Headers:**
    - `Content-Type: application/json`
    - `Authorization: Bearer {TOKEN}`

## Post Object Fields

### Available on Post objects:

- `id` - Post ID
- `text` - Post content
- `status` - draft, scheduled, sending, sent, error
- `sentAt` - When published (readable but NOT filterable)
- `dueAt` - When scheduled to publish (filterable)
- `createdAt` - When created in Buffer (filterable)
- `channel.descriptor` - Platform-specific name
- `channel.service` - Service identifier (linkedin, threads, etc.)
- `channel.postingGoal` - Goal stats object with goal, sentCount, scheduledCount, status

### PostsFiltersInput (What you CAN filter by):

- `channelIds: [[ChannelId!]]`
- `status: [[PostStatus!]]`
- `tags: TagComparator`
- `tagIds: [[TagId!]]`
- `dueAt: DateTimeComparator` ✅
- `createdAt: DateTimeComparator` ✅
- ❌ NO `sentAt` field

### PostSortableKey enum:

- `dueAt` - Sort by scheduled date
- `createdAt` - Sort by creation date
- ❌ NO `sentAt` value

## Example Queries

### Fetch Published Posts

```graphql
query GetPublishedPosts($orgId: OrganizationId!) {
  posts(
    input: {
      organizationId: $orgId
      filter: { status: [sent] }
      sort: [{ field: createdAt, direction: desc }]
    }
    first: 20
  ) {
    edges {
      node {
        id
        text
        sentAt
        channel {
          descriptor
          service
          postingGoal {
            goal
            sentCount
            scheduledCount
            status
          }
        }
      }
    }
  }
}
```

### Fetch Scheduled Posts by Date Range

```graphql
query GetScheduledPosts(
  $orgId: OrganizationId!,
  $start: DateTime!,
  $end: DateTime!
) {
  posts(
    input: {
      organizationId: $orgId
      filter: {
        status: [scheduled, sending]
        dueAt: { start: $start, end: $end }
      }
      sort: [{ field: dueAt, direction: asc }]
    }
    first: 100
  ) {
    edges {
      node {
        id
        text
        dueAt
        status
        channel {
          descriptor
          service
        }
      }
    }
  }
}
```

---

# Testing & Deployment

## Local Testing

**Note:** No local Node.js installed. All testing done via GitHub Actions.

## GitHub Actions Testing

1. Go to repository → **Actions** tab
2. Select **Weekly Buffer Summary** workflow
3. Click **Run workflow** button
4. Select branch: `main`
5. Click **Run workflow**
6. Check Slack for the message

## Viewing Logs

In the GitHub Actions run, the script outputs:

```
Fetching Buffer posts...
This week (full): 2026-03-16T00:00:00.000Z to 2026-03-22T23:59:59.999Z
Rest of this week: 2026-03-17T14:43:59.000Z to 2026-03-22T23:59:59.999Z
Next week: 2026-03-23T00:00:00.000Z to 2026-03-29T23:59:59.999Z
Fetched 20 published posts
Found 0 posts sent this week
Found 1 posts in queue for rest of this week
Found 3 posts in queue for next week

--- Message blocks to send ---
[Block Kit JSON structure]
--- End message ---

✅ Message sent to Slack successfully!
```

---

# Future Enhancements

## Potential API Changes

### 1. Add `sentAt: DateTimeComparator` to `PostsFiltersInput`

This would allow filtering published posts by publication date, similar to how `dueAt` filters scheduled posts. This would eliminate the need for the hybrid approach and make the query more efficient.

**Status:** ⏳ Not requested - The current hybrid approach works well, so this hasn't been requested from Buffer Support yet. Could be pursued if the client-side filtering becomes a bottleneck.

### 2. Expose Ideas via GraphQL API

When the streak-at-risk message is shown (nothing sent this week + nothing in queue for rest of week), pull 2-3 random ideas from the create space and display them in the message for immediate inspiration without requiring the user to navigate away.

**Status:** ⏳ Blocked - Buffer API doesn't currently support fetching ideas via GraphQL.

---

# Troubleshooting

## Common Issues

### "Posts scheduled for later today don't appear"

**Cause:** Using `nowIST` instead of `now` for `restOfWeekStart`

**Fix:** Use actual UTC time (`now`) for the rest-of-week start boundary

### "Links not showing in Slack"

**Cause:** Using Markdown format `[text](url)` instead of Slack format

**Fix:** Use Slack's `<url|text>` format

### "Bold text not working in Slack"

**Cause:** Using double asterisks `**bold**` instead of single

**Fix:** Use single asterisks `*bold*` for Slack mrkdwn

### "Icon and username not changing"

**Cause:** Trying to set via API (doesn't work with app-based webhooks)

**Fix:** Configure in Slack app settings at https://api.slack.com/apps

### "GitHub Actions deprecation warning about Node.js 20"

**Cause:** Actions using Node.js 20 will be upgraded to Node.js 24 by June 2026

**Fix:** Update to `actions/checkout@v5` and `actions/setup-node@v5` (optional for now)

### "No posts found when I know they exist"

**Cause:** Posts may be from a channel not in `ALLOWED_CHANNELS`

**Fix:** Check `src/config.js` and add the channel service to the allowed list

---

# Key Learnings

1. **Always check API documentation for filter capabilities** - Don't assume fields that exist on objects can be used in queries
2. **Hybrid approaches work** - Client-side filtering is acceptable when API limitations exist
3. **Timezone calculations are tricky** - Be careful mixing UTC and local times; use actual current time for boundaries
4. **Slack has its own markdown** - Standard Markdown doesn't work; use mrkdwn format
5. **Modern webhooks have restrictions** - App-based webhooks can't override icon/username via API
6. **Block Kit is more flexible** - Using Slack Block Kit allows better control over message layout and formatting than plain text
7. **Channel filtering is important** - Different users may have different platforms connected; make filtering configurable

import 'dotenv/config';
import fetch from 'node-fetch';
import { CONFIG } from './config.js';

const BUFFER_API_TOKEN = process.env.BUFFER_API_TOKEN;
const BUFFER_ORG_ID = process.env.BUFFER_ORG_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Helper: Get week boundaries in IST
function getWeekBoundaries() {
  const now = new Date();
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }));
  
  // Get current day of week (0 = Sunday, 1 = Monday, etc.)
  const currentDay = nowIST.getDay();
  const daysSinceMonday = (currentDay + 6) % 7; // Convert to Monday = 0
  
  // This week: Monday 00:00 to Sunday 23:59
  const thisWeekStart = new Date(nowIST);
  thisWeekStart.setDate(thisWeekStart.getDate() - daysSinceMonday);
  thisWeekStart.setHours(0, 0, 0, 0);
  
  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 6);
  thisWeekEnd.setHours(23, 59, 59, 999);
  
  // Rest of this week: now to Sunday 23:59
  const restOfWeekStart = new Date(now);
  const restOfWeekEnd = new Date(thisWeekEnd);
  
  // Next week: Monday 00:00 to Sunday 23:59
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
  nextWeekEnd.setHours(23, 59, 59, 999);
  
  return {
    thisWeekStart: thisWeekStart.toISOString(),
    thisWeekEnd: thisWeekEnd.toISOString(),
    restOfWeekStart: restOfWeekStart.toISOString(),
    restOfWeekEnd: restOfWeekEnd.toISOString(),
    nextWeekStart: nextWeekStart.toISOString(),
    nextWeekEnd: nextWeekEnd.toISOString()
  };
}

// Helper: Make GraphQL request to Buffer
async function bufferGraphQL(query, variables = {}) {
  const response = await fetch(CONFIG.BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BUFFER_API_TOKEN}`
    },
    body: JSON.stringify({ query, variables })
  });
  
  if (!response.ok) {
    throw new Error(`Buffer API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  
  return data.data;
}

// Fetch published posts (last 20, will filter client-side by sentAt)
async function fetchPublishedPosts() {
  const query = `
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
  `;

  const data = await bufferGraphQL(query, { orgId: BUFFER_ORG_ID });
  return data.posts.edges.map(edge => edge.node);
}

// Fetch scheduled posts for a date range
async function fetchScheduledPosts(startDate, endDate) {
  const query = `
    query GetScheduledPosts($orgId: OrganizationId!, $start: DateTime!, $end: DateTime!) {
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
            }
          }
        }
      }
    }
  `;
  
  const data = await bufferGraphQL(query, {
    orgId: BUFFER_ORG_ID,
    start: startDate,
    end: endDate
  });
  
  return data.posts.edges.map(edge => edge.node);
}

// Format date as "Monday, Mar 17, 2025"
function formatDate(dateString) {
  const date = new Date(dateString);
  const dateIST = new Date(date.toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }));
  
  return dateIST.toLocaleDateString('en-US', CONFIG.DATE_FORMAT);
}

// Truncate post text to max length
function truncateText(text) {
  if (text.length <= CONFIG.POST_TEXT_MAX_LENGTH) {
    return text;
  }
  return text.substring(0, CONFIG.POST_TEXT_MAX_LENGTH) + '...';
}

// Group posts by platform
function groupByPlatform(posts) {
  const grouped = {};
  
  posts.forEach(post => {
    const platform = post.channel.descriptor;
    if (!grouped[platform]) {
      grouped[platform] = [];
    }
    grouped[platform].push(post);
  });
  
  // Sort posts within each platform by date (oldest to newest)
  Object.keys(grouped).forEach(platform => {
    grouped[platform].sort((a, b) => {
      const dateA = new Date(a.sentAt || a.dueAt);
      const dateB = new Date(b.sentAt || b.dueAt);
      return dateA - dateB;
    });
  });
  
  return grouped;
}

// Build Slack message
function buildSlackMessage(sentThisWeek, queueThisWeek, queueNextWeek) {
  let message = '';
  
  // Section 1: Posts sent this week
  if (sentThisWeek.length === 0) {
    message += "Hi Shivani! You haven't posted anything this week 😔\n\n";
  } else {
    message += "Hi Shivani! Here's what your social media posting looked like this week.\n\n";
    
    const groupedSent = groupByPlatform(sentThisWeek);
    
    Object.keys(groupedSent).forEach(platform => {
      message += `*${platform}*\n`;

      const goal = groupedSent[platform][0].channel.postingGoal;
      if (goal) {
        const statusEmoji = { Hit: '✅', OnTrack: '👌', AtRisk: '⚠️' }[goal.status] ?? '';
        message += `Goal: ${goal.goal} posts/week · Sent: ${goal.sentCount} · Scheduled: ${goal.scheduledCount} · ${goal.status} ${statusEmoji}\n`;
      }

      groupedSent[platform].forEach(post => {
        const dateStr = formatDate(post.sentAt);
        const textStr = truncateText(post.text);
        const postUrl = `https://publish.buffer.com/calendar/post/${post.id}`;
        message += `*<${postUrl}|${dateStr}>:* ${textStr}\n`;
      });

      message += '\n';
    });
  }
  
  // Section 2: Posts in queue for rest of this week
  if (queueThisWeek.length > 0) {
    message += "*Here's what's in queue for this week:*\n\n";
    
    const groupedThisWeek = groupByPlatform(queueThisWeek);
    
    Object.keys(groupedThisWeek).forEach(platform => {
      message += `*${platform}*\n`;
      
      groupedThisWeek[platform].forEach(post => {
        const dateStr = formatDate(post.dueAt);
        const statusSuffix = post.status === 'sending' ? ' (scheduled)' : '';
        const textStr = truncateText(post.text);
        const postUrl = `https://publish.buffer.com/calendar/post/${post.id}`;
        message += `*<${postUrl}|${dateStr}${statusSuffix}>:* ${textStr}\n`;
      });
      
      message += '\n';
    });
  }
  
  // Section 3: Posts in queue for next week
  if (queueNextWeek.length === 0) {
    message += `Your queue for next week is empty right now. Head over to your <${CONFIG.CREATE_SPACE_URL}|Create Space> for inspiration ✨\n`;
  } else {
    message += "*Here's what's in queue for next week:*\n\n";
    
    const groupedNextWeek = groupByPlatform(queueNextWeek);
    
    Object.keys(groupedNextWeek).forEach(platform => {
      message += `*${platform}*\n`;
      
      groupedNextWeek[platform].forEach(post => {
        const dateStr = formatDate(post.dueAt);
        const statusSuffix = post.status === 'sending' ? ' (scheduled)' : '';
        const textStr = truncateText(post.text);
        const postUrl = `https://publish.buffer.com/calendar/post/${post.id}`;
        message += `*<${postUrl}|${dateStr}${statusSuffix}>:* ${textStr}\n`;
      });
      
      message += '\n';
    });
  }
  
  return message.trim();
}

// Send message to Slack
async function sendToSlack(message) {
  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message })
  });
  
  if (!response.ok) {
    throw new Error(`Slack webhook error: ${response.status} ${response.statusText}`);
  }
  
  return response;
}

// Main function
async function main() {
  try {
    console.log('Fetching Buffer posts...');
    
    const { thisWeekStart, thisWeekEnd, restOfWeekStart, restOfWeekEnd, nextWeekStart, nextWeekEnd } = getWeekBoundaries();
    
    console.log('This week (full):', thisWeekStart, 'to', thisWeekEnd);
    console.log('Rest of this week:', restOfWeekStart, 'to', restOfWeekEnd);
    console.log('Next week:', nextWeekStart, 'to', nextWeekEnd);
    
    // Fetch published posts (last 20)
    const allPublishedPosts = await fetchPublishedPosts();
    console.log(`Fetched ${allPublishedPosts.length} published posts`);
    
    // Filter by sentAt for this week
    const sentThisWeek = allPublishedPosts.filter(post => {
      if (!post.sentAt) return false;
      const sentAt = new Date(post.sentAt);
      return sentAt >= new Date(thisWeekStart) && sentAt <= new Date(thisWeekEnd);
    });
    
    console.log(`Found ${sentThisWeek.length} posts sent this week`);
    
    // Fetch scheduled posts for rest of this week
    const queueThisWeek = await fetchScheduledPosts(restOfWeekStart, restOfWeekEnd);
    console.log(`Found ${queueThisWeek.length} posts in queue for rest of this week`);
    
    // Fetch scheduled posts for next week
    const queueNextWeek = await fetchScheduledPosts(nextWeekStart, nextWeekEnd);
    console.log(`Found ${queueNextWeek.length} posts in queue for next week`);
    
    // Build and send message
    const message = buildSlackMessage(sentThisWeek, queueThisWeek, queueNextWeek);
    console.log('\n--- Message to send ---\n');
    console.log(message);
    console.log('\n--- End message ---\n');
    
    await sendToSlack(message);
    console.log('✅ Message sent to Slack successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
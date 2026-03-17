// Main script to fetch Buffer posts and send weekly summary to Slack

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { CONFIG } from './config.js';

dotenv.config();

const BUFFER_API_TOKEN = process.env.BUFFER_API_TOKEN;
const BUFFER_ORG_ID = '5aebdfa719520549010a5230';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Validate environment variables
if (!BUFFER_API_TOKEN) {
  console.error('Error: BUFFER_API_TOKEN not found');
  process.exit(1);
}

if (!SLACK_WEBHOOK_URL) {
  console.error('Error: SLACK_WEBHOOK_URL not found');
  process.exit(1);
}

// Get current date/time in IST
function getISTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }));
}

// Get Monday 00:00 IST of the current week
function getThisWeekStart() {
  const now = getISTDate();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // If Sunday, go back 6 days; otherwise go to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Get Sunday 23:59 IST of the current week
function getThisWeekEnd() {
  const start = getThisWeekStart();
  const sunday = new Date(start);
  sunday.setDate(start.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

// Get Monday 00:00 IST of next week
function getNextWeekStart() {
  const thisWeekEnd = getThisWeekEnd();
  const nextMonday = new Date(thisWeekEnd);
  nextMonday.setDate(thisWeekEnd.getDate() + 1);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}

// Get Sunday 23:59 IST of next week
function getNextWeekEnd() {
  const nextWeekStart = getNextWeekStart();
  const nextSunday = new Date(nextWeekStart);
  nextSunday.setDate(nextWeekStart.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);
  return nextSunday;
}

// Convert IST date to ISO 8601 UTC string for Buffer API
function toUTC(istDate) {
  return istDate.toISOString();
}

// Format date for Slack message: "Monday, Mar 17, 2025:"
function formatDate(isoString, status) {
  const date = new Date(isoString);
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }));
  
  const formatted = istDate.toLocaleDateString('en-US', CONFIG.DATE_FORMAT);
  const statusSuffix = status === 'sending' ? ' (scheduled)' : '';
  
  return `${formatted}${statusSuffix}:`;
}

// Truncate post text to 100 characters
function truncateText(text) {
  if (text.length <= CONFIG.POST_TEXT_MAX_LENGTH) {
    return text;
  }
  return text.substring(0, CONFIG.POST_TEXT_MAX_LENGTH) + '...';
}

// Fetch posts from Buffer GraphQL API
async function fetchBufferPosts(startDate, endDate, status) {
  const query = `
    query GetPosts($organizationId: OrganizationId!, $startDate: DateTime!, $endDate: DateTime!, $status: [PostStatus!]!) {
      posts(
        input: {
          organizationId: $organizationId
          filter: {
            status: $status
            ${status.includes('sent') ? 'sentAt' : 'dueAt'}: { start: $startDate, end: $endDate }
          }
          sort: [{ field: ${status.includes('sent') ? 'sentAt' : 'dueAt'}, direction: asc }]
        }
      ) {
        edges {
          node {
            text
            ${status.includes('sent') ? 'sentAt' : 'dueAt'}
            ${status.includes('scheduled') || status.includes('sending') ? 'status' : ''}
            channel {
              descriptor
            }
          }
        }
      }
    }
  `;

  const variables = {
    organizationId: BUFFER_ORG_ID,
    startDate: toUTC(startDate),
    endDate: toUTC(endDate),
    status
  };

  const response = await fetch(CONFIG.BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BUFFER_API_TOKEN}`
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();

  if (data.errors) {
    console.error('GraphQL errors:', JSON.stringify(data.errors, null, 2));
    throw new Error('Failed to fetch posts from Buffer');
  }

  return data.data.posts.edges.map(edge => edge.node);
}

// Group posts by platform
function groupByPlatform(posts, isScheduled) {
  const grouped = {};
  
  posts.forEach(post => {
    const platform = post.channel.descriptor;
    if (!grouped[platform]) {
      grouped[platform] = [];
    }
    
    const dateField = isScheduled ? 'dueAt' : 'sentAt';
    const formattedDate = formatDate(post[dateField], post.status);
    const truncatedText = truncateText(post.text);
    
    grouped[platform].push(`${formattedDate} ${truncatedText}`);
  });
  
  return grouped;
}

// Build Slack message
function buildSlackMessage(publishedPosts, scheduledPosts) {
  let message = 'Hi Shivani! ';
  
  // Handle "this week" section
  if (publishedPosts.length === 0) {
    message += "You haven't posted anything this week 😔\n\n";
  } else {
    message += "Here's what your social media posting looked like this week.\n\n";
    const groupedPublished = groupByPlatform(publishedPosts, false);
    
    for (const [platform, posts] of Object.entries(groupedPublished)) {
      message += `**${platform}**\n`;
      posts.forEach(post => {
        message += `${post}\n`;
      });
      message += '\n';
    }
  }
  
  // Handle "next week" section
  if (scheduledPosts.length === 0) {
    message += `Your queue for next week is empty right now. Head over to your [Create Space](${CONFIG.CREATE_SPACE_URL}) for inspiration ✨`;
  } else {
    message += "Here's what's in queue for next week:\n\n";
    const groupedScheduled = groupByPlatform(scheduledPosts, true);
    
    for (const [platform, posts] of Object.entries(groupedScheduled)) {
      message += `**${platform}**\n`;
      posts.forEach(post => {
        message += `${post}\n`;
      });
      message += '\n';
    }
  }
  
  return message.trim();
}

// Send message to Slack
async function sendToSlack(message) {
  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: message })
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.statusText}`);
  }
}

// Main execution
async function main() {
  try {
    console.log('Fetching Buffer posts...');
    
    // Calculate date ranges
    const thisWeekStart = getThisWeekStart();
    const thisWeekEnd = getThisWeekEnd();
    const nextWeekStart = getNextWeekStart();
    const nextWeekEnd = getNextWeekEnd();
    
    console.log(`This week: ${thisWeekStart.toISOString()} to ${thisWeekEnd.toISOString()}`);
    console.log(`Next week: ${nextWeekStart.toISOString()} to ${nextWeekEnd.toISOString()}`);
    
    // Fetch posts
    const publishedPosts = await fetchBufferPosts(thisWeekStart, thisWeekEnd, ['sent']);
    const scheduledPosts = await fetchBufferPosts(nextWeekStart, nextWeekEnd, ['scheduled', 'sending']);
    
    console.log(`Found ${publishedPosts.length} published posts and ${scheduledPosts.length} scheduled posts`);
    
    // Build and send message
    const slackMessage = buildSlackMessage(publishedPosts, scheduledPosts);
    console.log('\nSlack message:\n', slackMessage);
    
    await sendToSlack(slackMessage);
    console.log('\n✅ Message sent to Slack successfully!');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
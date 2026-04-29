// Configuration constants for the Buffer Slack workflow

export const CONFIG = {
  // Timezone for week calculations
  TIMEZONE: 'Asia/Kolkata', // IST
  
  // Week boundaries
  WEEK_START_DAY: 1, // Monday (0 = Sunday, 1 = Monday, etc.)
  
  // Buffer API
  BUFFER_API_URL: 'https://api.buffer.com',
  
  // Message formatting
  POST_TEXT_MAX_LENGTH: 200,
  DATE_FORMAT: {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  },
  
  // Slack message
  CREATE_SPACE_URL: 'https://publish.buffer.com/create/ideas?view=board',

  // Allowed channels to include in report (e.g. ['linkedin', 'threads'])
  ALLOWED_CHANNELS: ['linkedin']
};
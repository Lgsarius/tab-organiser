export const DEFAULT_SETTINGS = {
  autoGroup: false,          // Automatically group new tabs
  groupSingleTabs: false,    // Group domains even if there's only one tab
  colorByDomain: true,       // Use consistent colors for each domain
  maxGroupSize: 10,         // Maximum tabs in a group before creating a new one
  sortTabs: true,           // Sort tabs within groups by title
  autoCollapse: true,       // Automatically collapse groups
  pinGroups: false,         // Pin groups to the left
  groupBySubdomain: false,  // Group by full subdomain instead of main domain
  excludeDomains: [],       // Domains to never group
  customColors: {},         // Custom colors for specific domains
  groupEmptyTabs: false,    // Group empty tabs and new tabs
  smartGroups: true,        // Use smart grouping (e.g., all Google services together)
  darkMode: false,          // Dark mode theme
};

export const SMART_GROUPS = {
  'Google Services': ['google.com', 'gmail.com', 'drive.google.com', 'docs.google.com'],
  'Social Media': ['facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com'],
  'Microsoft': ['microsoft.com', 'office.com', 'live.com', 'outlook.com'],
  'Amazon': ['amazon.com', 'aws.amazon.com', 'kindle.com'],
};

export const GROUP_TEMPLATES = {
  'Work': {
    domains: ['slack.com', 'github.com', 'gitlab.com', 'jira.com'],
    color: 'blue'
  },
  'Social': {
    domains: ['facebook.com', 'twitter.com', 'instagram.com'],
    color: 'pink'
  },
  'Email': {
    domains: ['gmail.com', 'outlook.com', 'yahoo.com'],
    color: 'purple'
  }
};

export const GROUP_RULES = {
  workHours: {
    active: true,
    startTime: '09:00',
    endTime: '17:00',
    days: [1, 2, 3, 4, 5], // Monday to Friday
    templates: ['Work']
  },
  afterHours: {
    active: true,
    startTime: '17:00',
    endTime: '09:00',
    days: [1, 2, 3, 4, 5],
    templates: ['Social', 'Entertainment']
  }
};

export const GROUP_PRESETS = {
  'Minimal': {
    autoCollapse: true,
    groupSingleTabs: false,
    maxGroupSize: 5
  },
  'Power User': {
    autoCollapse: false,
    groupSingleTabs: true,
    smartGroups: true,
    sortTabs: true
  }
}; 
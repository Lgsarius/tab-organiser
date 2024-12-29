import { DEFAULT_SETTINGS, SMART_GROUPS } from './constants.js';
import { backgroundTimer } from './background-timer.js';

// Cache for domain colors
const domainColors = new Map();

// Listen for clicks on the extension icon
chrome.action.onClicked.addListener(async () => {
  await organizeTabs();
});

// Listen for new tabs being created
chrome.tabs.onCreated.addListener(async (tab) => {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (settings.autoGroup) {
    // Wait for the tab to finish loading to get its final URL
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        organizeTabs();
      }
    });
  }
});

// Add message listener for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case 'createGroupFromTemplate':
        createGroupFromTemplate(message.template);
        break;
      case 'undoUngroup':
        restoreLastGroupState();
        break;
      case 'archiveInactive':
        archiveInactiveGroups();
        break;
      case 'getGroupStatistics':
        collectGroupStatistics().then(sendResponse);
        return true;
      case 'getGroupSuggestions':
        suggestionEngine.suggestGroups().then(sendResponse);
        return true;
      case 'organize':
        organizeTabs();
        break;
      case 'pomodoroStart':
        backgroundTimer.start(message.type);
        sendResponse({ success: true });
        break;
      case 'pomodoroPause':
        backgroundTimer.pause();
        sendResponse({ success: true });
        break;
      case 'pomodoroReset':
        backgroundTimer.reset();
        sendResponse({ success: true });
        break;
      case 'pomodoroUpdateSettings':
        backgroundTimer.updateSettings(message.settings);
        sendResponse({ success: true });
        break;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  // Create main context menu item
  chrome.contextMenus.create({
    id: 'tabOrganizer',
    title: 'Tab Organizer',
    contexts: ['page'] // Use valid context value
  });

  // Create sub-items
  chrome.contextMenus.create({
    id: 'organizeTabs',
    parentId: 'tabOrganizer',
    title: 'Organize All Tabs',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'ungroupTabs',
    parentId: 'tabOrganizer',
    title: 'Ungroup All Tabs',
    contexts: ['page']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'organizeTabs':
      chrome.runtime.sendMessage({ action: 'organize' });
      break;
    case 'ungroupTabs':
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.ungroup(tabs.map(tab => tab.id));
        }
      });
      break;
  }
});

function getDomainFromUrl(url, useSubdomain) {
  try {
    const urlObj = new URL(url);
    if (useSubdomain) {
      return urlObj.hostname;
    }
    const parts = urlObj.hostname.split('.');
    return parts.slice(-2).join('.');
  } catch (e) {
    return null;
  }
}

function getSmartGroup(domain) {
  for (const [groupName, domains] of Object.entries(SMART_GROUPS)) {
    if (domains.some(d => domain.includes(d))) {
      return groupName;
    }
  }
  return null;
}

async function organizeTabs() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  // Create a map to store tabs by domain/group
  const tabsByGroup = new Map();
  
  // Group tabs
  tabs.forEach(tab => {
    try {
      // Skip excluded domains
      if (settings.excludeDomains.some(d => tab.url.includes(d))) {
        return;
      }

      // Handle empty tabs
      if (!tab.url || tab.url === 'chrome://newtab/') {
        if (settings.groupEmptyTabs) {
          const group = 'Empty Tabs';
          if (!tabsByGroup.has(group)) {
            tabsByGroup.set(group, []);
          }
          tabsByGroup.get(group).push(tab);
        }
        return;
      }

      // Skip chrome:// and extension:// URLs
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('extension://')) {
        return;
      }

      const domain = getDomainFromUrl(tab.url, settings.groupBySubdomain);
      if (!domain) return;

      let groupKey = domain;
      
      // Apply smart grouping if enabled
      if (settings.smartGroups) {
        const smartGroup = getSmartGroup(domain);
        if (smartGroup) {
          groupKey = smartGroup;
        }
      }

      if (!tabsByGroup.has(groupKey)) {
        tabsByGroup.set(groupKey, []);
      }
      tabsByGroup.get(groupKey).push(tab);
    } catch (e) {
      console.log('Error processing tab:', e);
    }
  });

  // Sort tabs if enabled
  if (settings.sortTabs) {
    for (const [_, groupTabs] of tabsByGroup) {
      groupTabs.sort((a, b) => a.title.localeCompare(b.title));
    }
  }

  // Create or update groups
  for (const [groupName, groupTabs] of tabsByGroup) {
    if (groupTabs.length < 2 && !settings.groupSingleTabs) continue;

    // Split into smaller groups if needed
    const groups = splitIntoGroups(groupTabs.map(t => t.id), settings.maxGroupSize);

    for (let i = 0; i < groups.length; i++) {
      const tabIds = groups[i];
      
      try {
        // Create group
        const group = await chrome.tabs.group({ tabIds });

        // Get color for group
        let color;
        if (settings.customColors[groupName]) {
          color = settings.customColors[groupName];
        } else if (settings.colorByDomain) {
          color = getDomainColor(groupName);
        } else {
          color = getRandomColor();
        }

        // Update group properties
        await chrome.tabGroups.update(group, {
          collapsed: settings.autoCollapse,
          title: groups.length > 1 ? `${groupName} (${i + 1})` : groupName,
          color: color
        });

        // Pin group if enabled
        if (settings.pinGroups) {
          for (const tabId of tabIds) {
            await chrome.tabs.update(tabId, { pinned: true });
          }
        }
      } catch (e) {
        console.log('Error creating group:', e);
      }
    }
  }
}

function splitIntoGroups(tabIds, maxSize) {
  const groups = [];
  for (let i = 0; i < tabIds.length; i += maxSize) {
    groups.push(tabIds.slice(i, i + maxSize));
  }
  return groups;
}

function getDomainColor(domain) {
  if (!domainColors.has(domain)) {
    domainColors.set(domain, getRandomColor());
  }
  return domainColors.get(domain);
}

function getRandomColor() {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  return colors[Math.floor(Math.random() * colors.length)];
}

chrome.tabs.onCreated.addListener(async (tab) => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length > 20) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Too Many Tabs',
      message: 'You have a lot of tabs open. Would you like to organize them?'
    });
  }
});

async function suspendInactiveGroups() {
  const groups = await chrome.tabGroups.query({});
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const lastAccessed = Math.max(...tabs.map(t => t.lastAccessed));
    if (Date.now() - lastAccessed > 24 * 60 * 60 * 1000) { // 24 hours
      tabs.forEach(tab => chrome.tabs.discard(tab.id));
    }
  }
}

// Initialize background timer
backgroundTimer.initialize();

// Handle alarm events for the timer
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('Alarm fired:', alarm.name); // Debug log
  if (alarm.name === 'pomodoroTick') {
    backgroundTimer.tick();
  }
});

// Add this function to check if domains belong to the same smart group
function areDomainsRelated(domain1, domain2) {
  for (const [groupName, domains] of Object.entries(SMART_GROUPS)) {
    const hasDomain1 = domains.some(d => domain1.includes(d));
    const hasDomain2 = domains.some(d => domain2.includes(d));
    if (hasDomain1 && hasDomain2) {
      return true;
    }
  }
  return false;
}

// Modify the tabs.onUpdated listener to include smart grouping check
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    try {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const settings = await chrome.storage.sync.get(['smartGroups']);
        const group = await chrome.tabGroups.get(tab.groupId);
        const groupDomain = extractDomainFromTitle(group.title);
        const tabDomain = extractDomain(tab.url);

        if (groupDomain && tabDomain) {
          const shouldStayGrouped = groupDomain === tabDomain || 
            (settings.smartGroups && areDomainsRelated(groupDomain, tabDomain));

          if (!shouldStayGrouped) {
            await chrome.tabs.ungroup(tabId);
          }
        }
      }
    } catch (error) {
      console.error('Error handling tab update:', error);
    }
  }
});

// Helper function to extract domain from group title
function extractDomainFromTitle(title) {
  // Remove any count indicators like (3) from the title
  const cleanTitle = title.replace(/\s*\(\d+\)$/, '');
  return cleanTitle.toLowerCase();
}

// Helper function to extract domain from URL
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    // Remove 'www.' if present
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

let groupHistory = new Map(); // Store recent group configurations

// Save group state before ungrouping
async function saveGroupState() {
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    groupHistory.set(group.id, {
      title: group.title,
      color: group.color,
      tabIds: tabs.map(tab => tab.id)
    });
  }
}

// Add an "Undo" option to restore the last grouping state
chrome.contextMenus.create({
  id: 'undoUngroup',
  parentId: 'tabOrganizer',
  title: 'Undo Last Ungroup',
  contexts: ['page']
});

// Add custom group templates
async function createGroupFromTemplate(templateName) {
  const settings = await chrome.storage.sync.get(['groupTemplates']);
  const template = settings.groupTemplates?.[templateName];
  
  if (template) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const matchingTabs = tabs.filter(tab => 
      template.domains.some(domain => tab.url.includes(domain))
    );
    
    if (matchingTabs.length > 0) {
      const groupId = await chrome.tabs.group({ 
        tabIds: matchingTabs.map(tab => tab.id) 
      });
      await chrome.tabGroups.update(groupId, {
        title: templateName,
        color: template.color
      });
    }
  }
}

// Add group analytics
async function collectGroupStatistics() {
  const stats = {
    groupCount: 0,
    tabsPerGroup: {},
    domainFrequency: {},
    averageGroupSize: 0
  };

  const groups = await chrome.tabGroups.query({});
  stats.groupCount = groups.length;

  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    stats.tabsPerGroup[group.title] = tabs.length;
    
    tabs.forEach(tab => {
      const domain = extractDomain(tab.url);
      stats.domainFrequency[domain] = (stats.domainFrequency[domain] || 0) + 1;
    });
  }

  stats.averageGroupSize = Object.values(stats.tabsPerGroup)
    .reduce((sum, count) => sum + count, 0) / groups.length;

  return stats;
}

// Add automatic archiving of inactive groups
async function archiveInactiveGroups(inactiveThreshold = 7 * 24 * 60 * 60 * 1000) { // 7 days
  const groups = await chrome.tabGroups.query({});
  
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const lastAccessed = Math.max(...tabs.map(tab => tab.lastAccessed));
    
    if (Date.now() - lastAccessed > inactiveThreshold) {
      // Save group info to bookmarks
      const bookmarkFolder = await chrome.bookmarks.create({
        title: `Archived: ${group.title} (${new Date().toLocaleDateString()})`
      });
      
      for (const tab of tabs) {
        await chrome.bookmarks.create({
          parentId: bookmarkFolder.id,
          title: tab.title,
          url: tab.url
        });
      }
      
      // Close tabs after archiving
      await chrome.tabs.remove(tabs.map(tab => tab.id));
    }
  }
}

// Add smart group suggestions based on user behavior
class GroupSuggestionEngine {
  constructor() {
    this.patterns = new Map();
  }

  async recordPattern(tabs) {
    const domains = tabs.map(tab => extractDomain(tab.url));
    const pattern = domains.sort().join(',');
    this.patterns.set(pattern, (this.patterns.get(pattern) || 0) + 1);
    
    await chrome.storage.local.set({ 
      groupPatterns: Object.fromEntries(this.patterns) 
    });
  }

  async suggestGroups(tabs) {
    const currentDomains = tabs.map(tab => extractDomain(tab.url)).sort();
    const suggestions = [];
    
    this.patterns.forEach((count, pattern) => {
      const patternDomains = pattern.split(',');
      const overlap = currentDomains.filter(d => patternDomains.includes(d));
      
      if (overlap.length >= 2) {
        suggestions.push({
          domains: patternDomains,
          confidence: (overlap.length / patternDomains.length) * count
        });
      }
    });

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }
}

// Add this function to restore group state
async function restoreLastGroupState() {
  if (groupHistory.size === 0) return;
  
  const lastEntry = Array.from(groupHistory.entries()).pop();
  if (lastEntry) {
    const [groupId, groupData] = lastEntry;
    try {
      const newGroupId = await chrome.tabs.group({ tabIds: groupData.tabIds });
      await chrome.tabGroups.update(newGroupId, {
        title: groupData.title,
        color: groupData.color
      });
      groupHistory.delete(groupId);
    } catch (error) {
      console.error('Error restoring group:', error);
    }
  }
}

// Initialize the suggestion engine
const suggestionEngine = new GroupSuggestionEngine(); 
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
    if (message.action === 'organize') {
      organizeTabs();
    } else if (message.action === 'pomodoroStart') {
      backgroundTimer.start(message.type);
      sendResponse({ success: true });
    } else if (message.action === 'pomodoroPause') {
      backgroundTimer.pause();
      sendResponse({ success: true });
    } else if (message.action === 'pomodoroReset') {
      backgroundTimer.reset();
      sendResponse({ success: true });
    } else if (message.action === 'pomodoroUpdateSettings') {
      backgroundTimer.updateSettings(message.settings);
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true; // Keep the message channel open for async response
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
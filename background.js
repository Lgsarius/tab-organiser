import { DEFAULT_SETTINGS, SMART_GROUPS } from './constants.js';

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
  if (message.action === 'organize') {
    organizeTabs();
  }
});

// Add context menu items
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'organize-similar',
    title: 'Group similar tabs',
    contexts: ['tab']
  });
  
  chrome.contextMenus.create({
    id: 'ungroup-tab',
    title: 'Ungroup this tab',
    contexts: ['tab']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'organize-similar') {
    try {
      const domain = getDomainFromUrl(tab.url, false);
      if (domain) {
        const similarTabs = await chrome.tabs.query({ currentWindow: true });
        const tabIds = similarTabs
          .filter(t => {
            try {
              return getDomainFromUrl(t.url, false) === domain;
            } catch (e) {
              return false;
            }
          })
          .map(t => t.id);
        
        if (tabIds.length > 0) {
          const group = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(group, {
            collapsed: true,
            title: domain,
            color: getDomainColor(domain)
          });
        }
      }
    } catch (e) {
      console.error('Error organizing similar tabs:', e);
    }
  } else if (info.menuItemId === 'ungroup-tab') {
    try {
      await chrome.tabs.ungroup(tab.id);
    } catch (e) {
      console.error('Error ungrouping tab:', e);
    }
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
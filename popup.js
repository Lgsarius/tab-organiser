import { DEFAULT_SETTINGS, SMART_GROUPS } from './constants.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize theme based on saved preference
  await initializeTheme();
  await loadSettings();
  await updateStatistics();
  setupEventListeners();
});

async function initializeTheme() {
  const settings = await chrome.storage.sync.get({ darkMode: false });
  if (settings.darkMode) {
    document.documentElement.classList.add('dark');
  }
  setupThemeToggle();
}

function setupThemeToggle() {
  const themeToggle = document.getElementById('theme-toggle');
  const darkIcon = document.getElementById('theme-toggle-dark-icon');
  const lightIcon = document.getElementById('theme-toggle-light-icon');
  const slider = themeToggle.querySelector('div');

  themeToggle.addEventListener('click', async () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    
    // Save theme preference
    await chrome.storage.sync.set({ darkMode: isDark });
    
    // Update slider position and icon visibility
    if (isDark) {
      slider.style.transform = 'translateX(1.75rem)';
      darkIcon.style.opacity = '0';
      lightIcon.style.opacity = '1';
    } else {
      slider.style.transform = 'translateX(0)';
      darkIcon.style.opacity = '1';
      lightIcon.style.opacity = '0';
    }
  });
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  
  // Load all checkbox settings
  document.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.checked = settings[input.id] || false;
    input.addEventListener('change', saveSetting);
  });
}

async function updateStatistics() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    
    document.getElementById('totalTabs').textContent = tabs.length;
    document.getElementById('groupCount').textContent = groups.length;
  } catch (error) {
    console.error('Error updating statistics:', error);
  }
}

function setupEventListeners() {
  // Organize button
  const organizeButton = document.getElementById('organize');
  organizeButton.addEventListener('click', handleOrganize);
  
  // Ungroup button
  const ungroupButton = document.getElementById('ungroup');
  ungroupButton.addEventListener('click', handleUngroup);
}

async function handleOrganize() {
  const button = document.getElementById('organize');
  
  // Set loading state
  button.disabled = true;
  button.classList.add('loading');
  button.innerHTML = `
    <span class="relative flex h-3 w-3">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
      <span class="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
    </span>
    <span class="font-semibold">Organizing...</span>
  `;

  try {
    await chrome.runtime.sendMessage({ action: 'organize' });
    await updateStatistics();
    showStatus('Tabs organized successfully!');
  } catch (error) {
    showStatus('Error organizing tabs. Please try again.', true);
  } finally {
    // Reset button state
    button.disabled = false;
    button.classList.remove('loading');
    button.innerHTML = `
      <span class="relative flex h-3 w-3">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
      </span>
      <span class="font-semibold">Organize All Tabs</span>
      <i class="fas fa-layer-group text-lg opacity-90 group-hover:transform group-hover:scale-110 transition-transform"></i>
    `;
  }
}

async function handleUngroup() {
  const button = document.getElementById('ungroup');
  
  // Set loading state
  button.disabled = true;
  button.classList.add('loading');
  button.innerHTML = `
    <span class="font-semibold">Ungrouping...</span>
    <i class="fas fa-spinner fa-spin text-lg"></i>
  `;

  try {
    // Get all tabs in current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Ungroup all tabs
    if (tabs.length > 0) {
      await chrome.tabs.ungroup(tabs.map(tab => tab.id));
    }
    
    await updateStatistics();
    showStatus('All tabs ungrouped successfully!');
  } catch (error) {
    console.error('Error ungrouping tabs:', error);
    showStatus('Error ungrouping tabs. Please try again.', true);
  } finally {
    // Reset button state
    button.disabled = false;
    button.classList.remove('loading');
    button.innerHTML = `
      <span class="font-semibold">Ungroup All</span>
      <i class="fas fa-layer-group fa-flip-vertical text-lg opacity-90 group-hover:transform group-hover:scale-110 transition-transform"></i>
    `;
  }
}

async function saveSetting(event) {
  const setting = {};
  setting[event.target.id] = event.target.checked;
  await chrome.storage.sync.set(setting);
  
  // Update toggle button appearance
  const toggle = event.target.nextElementSibling;
  if (event.target.checked) {
    toggle.classList.add('bg-primary-600');
  } else {
    toggle.classList.remove('bg-primary-600');
  }
  
  showStatus('Setting saved!');
}

function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.querySelector('.text-sm').textContent = message;
  status.style.opacity = '1';
  
  if (isError) {
    status.classList.add('bg-red-100', 'dark:bg-red-900');
    status.classList.remove('bg-white', 'dark:bg-gray-800');
  }

  setTimeout(() => {
    status.style.opacity = '0';
    if (isError) {
      setTimeout(() => {
        status.classList.remove('bg-red-100', 'dark:bg-red-900');
        status.classList.add('bg-white', 'dark:bg-gray-800');
      }, 300);
    }
  }, 2000);
} 
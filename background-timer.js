import { POMODORO_STATES } from './constants.js';

class BackgroundTimer {
  constructor() {
    this.state = POMODORO_STATES.IDLE;
    this.timeRemaining = 0;
    this.completedPomodoros = 0;
    this.settings = null;
    this.isPaused = false;
    this.port = null;
  }

  async initialize() {
    this.settings = await chrome.storage.sync.get({
      pomodoroEnabled: false,
      pomodoroWorkDuration: 25,
      pomodoroBreakDuration: 5,
      pomodoroLongBreakDuration: 15,
      pomodoroNotifications: true,
    });

    this.timeRemaining = this.settings.pomodoroWorkDuration * 60;
    this.updateBadge();

    // Listen for connections from the popup
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'pomodoro') {
        this.port = port;
        this.sendUpdate();
        
        port.onDisconnect.addListener(() => {
          this.port = null;
        });
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'pomodoroStart':
          this.start();
          break;
        case 'pomodoroPause':
          this.pause();
          break;
        case 'pomodoroReset':
          this.reset();
          break;
        case 'pomodoroUpdateSettings':
          this.updateSettings(message.settings);
          break;
      }
      // Send response to avoid error
      sendResponse({ success: true });
      return true;
    });
  }

  start(type = POMODORO_STATES.WORK) {
    console.log('Starting timer with type:', type); // Debug log
    
    if (!this.settings.pomodoroEnabled) {
      console.log('Timer not enabled'); // Debug log
      return false;
    }

    if (!this.isPaused) {
      this.state = type;
      this.timeRemaining = this.getDuration(type) * 60;
    }
    
    this.isPaused = false;
    
    // Clear any existing alarm first
    chrome.alarms.clear('pomodoroTick', () => {
      // Create new alarm
      chrome.alarms.create('pomodoroTick', { 
        periodInMinutes: 1/60,
        when: Date.now() // Start immediately
      });
      
      this.updateBadge();
      this.sendUpdate();
    });

    return true;
  }

  pause() {
    chrome.alarms.clear('pomodoroTick');
    this.isPaused = true;
    this.sendUpdate();
  }

  reset() {
    chrome.alarms.clear('pomodoroTick');
    this.state = POMODORO_STATES.IDLE;
    this.timeRemaining = this.settings.pomodoroWorkDuration * 60;
    this.completedPomodoros = 0;
    this.isPaused = false;
    this.updateBadge();
    this.sendUpdate();
  }

  tick() {
    console.log('Tick:', this.timeRemaining); // Debug log
    
    if (!this.settings.pomodoroEnabled || this.isPaused) {
      console.log('Timer disabled or paused'); // Debug log
      return;
    }
    
    if (this.timeRemaining > 0) {
      this.timeRemaining--;
      this.updateBadge();
      this.sendUpdate();

      if (this.timeRemaining <= 0) {
        this.complete();
      }
    }
  }

  getDuration(type) {
    switch (type) {
      case POMODORO_STATES.WORK:
        return this.settings.pomodoroWorkDuration;
      case POMODORO_STATES.BREAK:
        return this.settings.pomodoroBreakDuration;
      case POMODORO_STATES.LONG_BREAK:
        return this.settings.pomodoroLongBreakDuration;
      default:
        return this.settings.pomodoroWorkDuration;
    }
  }

  async complete() {
    chrome.alarms.clear('pomodoroTick');

    if (this.state === POMODORO_STATES.WORK) {
      this.completedPomodoros++;
      
      if (this.settings.pomodoroNotifications) {
        await this.showNotification('Work session complete!', 'Time for a break.');
      }

      if (this.completedPomodoros % 4 === 0) {
        this.start(POMODORO_STATES.LONG_BREAK);
      } else {
        this.start(POMODORO_STATES.BREAK);
      }
    } else {
      if (this.settings.pomodoroNotifications) {
        await this.showNotification('Break complete!', 'Ready to work?');
      }
      this.start(POMODORO_STATES.WORK);
    }
  }

  updateBadge() {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    const text = this.state === POMODORO_STATES.IDLE ? '' : 
      `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    const color = this.state === POMODORO_STATES.WORK ? '#EF4444' : '#10B981';
    
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  }

  sendUpdate() {
    if (this.port) {
      this.port.postMessage({
        timeRemaining: this.timeRemaining,
        state: this.state,
        isPaused: this.isPaused,
        completedPomodoros: this.completedPomodoros,
        settings: this.settings
      });
    }
  }

  async showNotification(title, message) {
    return new Promise((resolve) => {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message,
        requireInteraction: true,
      }, resolve);
    });
  }

  async updateSettings(newSettings) {
    try {
      // Validate settings
      if (newSettings.pomodoroWorkDuration) {
        newSettings.pomodoroWorkDuration = Math.max(1, Math.min(60, newSettings.pomodoroWorkDuration));
      }
      if (newSettings.pomodoroBreakDuration) {
        newSettings.pomodoroBreakDuration = Math.max(1, Math.min(30, newSettings.pomodoroBreakDuration));
      }
      if (newSettings.pomodoroLongBreakDuration) {
        newSettings.pomodoroLongBreakDuration = Math.max(1, Math.min(60, newSettings.pomodoroLongBreakDuration));
      }

      this.settings = { ...this.settings, ...newSettings };
      await chrome.storage.sync.set(newSettings);
      
      // Update timer if in IDLE state
      if (this.state === POMODORO_STATES.IDLE) {
        this.timeRemaining = this.settings.pomodoroWorkDuration * 60;
        this.updateBadge();
      }
      
      this.sendUpdate();
      return true;
    } catch (error) {
      console.error('Error updating settings:', error);
      return false;
    }
  }
}

export const backgroundTimer = new BackgroundTimer(); 
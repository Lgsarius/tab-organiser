import { POMODORO_STATES } from './constants.js';

class PomodoroTimer {
  constructor() {
    this.port = null;
    this.state = POMODORO_STATES.IDLE;
    this.timeRemaining = 0;
    this.completedPomodoros = 0;
    this.settings = null;
    this.isPaused = false;
  }

  async initialize() {
    try {
      // Connect to background script
      this.port = chrome.runtime.connect({ name: 'pomodoro' });
      
      // Listen for updates from background
      this.port.onMessage.addListener((update) => {
        this.state = update.state;
        this.timeRemaining = update.timeRemaining;
        this.completedPomodoros = update.completedPomodoros;
        this.settings = update.settings;
        this.isPaused = update.isPaused;
        this.updateDisplay();
        this.updateButtonStates();
      });

      // Initial display update
      this.updateDisplay();
    } catch (error) {
      console.error('Error initializing Pomodoro timer:', error);
    }
  }

  updateButtonStates() {
    const startBtn = document.getElementById('pomodoro-start');
    const pauseBtn = document.getElementById('pomodoro-pause');
    
    if (startBtn && pauseBtn) {
      if (this.isPaused || this.state === POMODORO_STATES.IDLE) {
        startBtn.disabled = false;
        pauseBtn.disabled = true;
      } else {
        startBtn.disabled = true;
        pauseBtn.disabled = false;
      }
    }
  }

  async start() {
    try {
      if (!this.settings?.pomodoroEnabled) {
        showStatus('Please enable Pomodoro timer first', true);
        return;
      }
      
      const response = await chrome.runtime.sendMessage({ 
        action: 'pomodoroStart',
        type: POMODORO_STATES.WORK 
      });
      
      if (!response?.success) {
        showStatus('Failed to start timer', true);
      }
    } catch (error) {
      console.error('Error starting timer:', error);
      showStatus('Error starting timer', true);
    }
  }

  async pause() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'pomodoroPause' });
      if (!response?.success) {
        showStatus('Failed to pause timer', true);
      }
    } catch (error) {
      console.error('Error pausing timer:', error);
      showStatus('Error pausing timer', true);
    }
  }

  async reset() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'pomodoroReset' });
      if (!response?.success) {
        showStatus('Failed to reset timer', true);
      }
    } catch (error) {
      console.error('Error resetting timer:', error);
      showStatus('Error resetting timer', true);
    }
  }

  updateDisplay() {
    const timeDisplay = document.getElementById('pomodoro-time');
    const stateDisplay = document.getElementById('pomodoro-state');
    const progressDisplay = document.getElementById('pomodoro-progress');

    if (!timeDisplay || !stateDisplay || !progressDisplay) return;

    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const stateText = {
      [POMODORO_STATES.WORK]: 'Working',
      [POMODORO_STATES.BREAK]: 'Short Break',
      [POMODORO_STATES.LONG_BREAK]: 'Long Break',
      [POMODORO_STATES.IDLE]: 'Ready to Start',
    }[this.state];
    
    stateDisplay.textContent = this.isPaused ? 'Paused' : stateText;
    progressDisplay.textContent = `Pomodoro #${this.completedPomodoros + 1}`;
  }

  async updateSettings(newSettings) {
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'pomodoroUpdateSettings', 
        settings: newSettings 
      });
      
      if (!response?.success) {
        throw new Error('Failed to update settings');
      }
      
      // Update local settings immediately for better UX
      this.settings = { ...this.settings, ...newSettings };
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }
}

// Helper function for showing status messages
function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  if (status) {
    const textElement = status.querySelector('.text-sm');
    if (textElement) {
      textElement.textContent = message;
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
  }
}

export const pomodoroTimer = new PomodoroTimer(); 
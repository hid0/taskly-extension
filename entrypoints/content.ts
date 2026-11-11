const STORAGE_TIMER_SYNC_KEY = 'taskly_shared_timer_v1';
const BROADCAST_CHANNEL_NAME = 'taskly_multi_tab_sync';

interface SharedTimerState {
  activeTaskId: string | null;
  startedAt: number | null;
  baseLoggedSeconds: number;
  timerMode: 'work' | 'break_prompt' | 'break';
  breakDurationSeconds: number;
  breakStartedAt: number | null;
  lastCompletedTaskId: string | null;
  date: string;
  updatedAt: number;
}

function getLocalTodayString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default defineContentScript({
  matches: ['https://task.faizhid.my.id/*'],
  runAt: 'document_idle',
  main() {
    let lastRawState = '';
    let cachedItems: any[] = [];
    let lastFetchedDate = '';
    let bc: BroadcastChannel | null = null;

    async function fetchItemsForDate(dateStr: string, force = false) {
      if (!force && cachedItems.length > 0 && lastFetchedDate === dateStr) {
        return cachedItems;
      }
      try {
        const res = await fetch(`/api/taskly?date=${encodeURIComponent(dateStr)}`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.items)) {
            cachedItems = data.items;
            lastFetchedDate = dateStr;
          }
        }
      } catch {
        // Ignore fetch errors if offline or unauthenticated
      }
      return cachedItems;
    }

    function readSharedState(): SharedTimerState | null {
      const raw = window.localStorage.getItem(STORAGE_TIMER_SYNC_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SharedTimerState;
      } catch {
        return null;
      }
    }

    async function syncWebToExtension(forceFetch = false) {
      const raw = window.localStorage.getItem(STORAGE_TIMER_SYNC_KEY) || '';
      const state = readSharedState();
      const targetDate = state?.date || getLocalTodayString();

      const items = await fetchItemsForDate(targetDate, forceFetch);
      lastRawState = raw;

      try {
        chrome.runtime.sendMessage({
          type: 'WEB_STATE_SYNC',
          state,
          items,
          origin: window.location.origin
        });
      } catch {
        // Extension context invalidated or background asleep
      }
    }

    // 1. Listen to BroadcastChannel from useTasklyStore in the web app
    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'TIMER_STATE' || msg.type === 'DATA_UPDATED' || msg.type === 'AUTH_CHANGED') {
          syncWebToExtension(msg.type === 'DATA_UPDATED' || msg.type === 'AUTH_CHANGED');
        }
      };
    }

    // 2. Listen to storage events from other tabs
    window.addEventListener('storage', (ev) => {
      if (ev.key === STORAGE_TIMER_SYNC_KEY) {
        syncWebToExtension(false);
      }
    });

    // 3. Poll localStorage every 1s to detect same-tab changes immediately
    setInterval(() => {
      const currentRaw = window.localStorage.getItem(STORAGE_TIMER_SYNC_KEY) || '';
      if (currentRaw !== lastRawState) {
        syncWebToExtension(false);
      }
    }, 1000);

    // 4. Listen to commands from Extension Popup / Background (Start / Stop Timer)
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'EXT_REQUEST_SYNC') {
        syncWebToExtension(true).then(() => sendResponse({ ok: true }));
        return true;
      }

      if (message.type === 'EXT_APPLY_TIMER_STATE' && message.state) {
        const nextState: SharedTimerState = message.state;
        const raw = JSON.stringify(nextState);
        lastRawState = raw;
        window.localStorage.setItem(STORAGE_TIMER_SYNC_KEY, raw);

        if (bc) {
          try {
            bc.postMessage({ type: 'TIMER_STATE', state: nextState });
            if (message.dataUpdated) {
              bc.postMessage({ type: 'DATA_UPDATED' });
            }
          } catch {}
        }

        window.dispatchEvent(
          new StorageEvent('storage', {
            key: STORAGE_TIMER_SYNC_KEY,
            newValue: raw
          })
        );

        sendResponse({ ok: true });
        return true;
      }
    });

    // Initial sync on load
    syncWebToExtension(true);
  }
});

interface DailyItem {
  id: string;
  parentId: string | null;
  date: string;
  type: 'task' | 'note' | 'event';
  title: string;
  isCompleted: boolean;
  categoryId: string | null;
  estimatedSessions: number;
  completedSessions: number;
  loggedSeconds: number;
  sortOrder: number;
}

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

const POMODORO_SECONDS = 25 * 60;
const DEFAULT_ORIGIN = 'https://task.faizhid.my.id';

function getLocalTodayString(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default defineBackground(() => {
  // Support both Manifest V3 (chrome.action) and Firefox Manifest V2 (chrome.browserAction)
  const actionApi = chrome.action || (chrome as any).browserAction;

  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let apiOrigin = DEFAULT_ORIGIN;
  let items: DailyItem[] = [];
  let sharedState: SharedTimerState = {
    activeTaskId: null,
    startedAt: null,
    baseLoggedSeconds: 0,
    timerMode: 'work',
    breakDurationSeconds: 300,
    breakStartedAt: null,
    lastCompletedTaskId: null,
    date: getLocalTodayString(),
    updatedAt: Date.now()
  };
  let lastNotifiedSessionKey = '';

  function setBadge(text: string, color?: string) {
    if (!actionApi) return;
    try {
      actionApi.setBadgeText({ text });
      if (color) {
        actionApi.setBadgeBackgroundColor({ color });
      }
    } catch {}
  }

  function queryTasklyTabs(): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ url: ['https://task.faizhid.my.id/*'] }, (tabs) => {
          if (chrome.runtime.lastError || !tabs) {
            resolve([]);
          } else {
            resolve(tabs);
          }
        });
      } catch {
        resolve([]);
      }
    });
  }

  function sendTabMessage(tabId: number, payload: any): Promise<any> {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, payload, (res) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(res);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  // Restore saved state from chrome.storage.local on startup
  chrome.storage.local.get(['taskly_ext_state', 'taskly_ext_items', 'taskly_ext_origin'], (res) => {
    if (res?.taskly_ext_origin) apiOrigin = res.taskly_ext_origin;
    if (Array.isArray(res?.taskly_ext_items)) items = res.taskly_ext_items;
    if (res?.taskly_ext_state) {
      sharedState = res.taskly_ext_state;
      updateTickerAndBadge();
    }
    requestSyncFromOpenTabs();
  });

  function persistToStorage() {
    chrome.storage.local.set({
      taskly_ext_state: sharedState,
      taskly_ext_items: items,
      taskly_ext_origin: apiOrigin
    });
  }

  function computeLiveStatus() {
    let activeTask: (DailyItem & { remainingSeconds: number }) | null = null;
    let breakRemainingSeconds = 0;

    if (sharedState.timerMode === 'work' && sharedState.activeTaskId && sharedState.startedAt) {
      const found = items.find((i) => i.id === sharedState.activeTaskId);
      const elapsed = Math.max(0, Math.floor((Date.now() - sharedState.startedAt) / 1000));
      const liveSeconds = (sharedState.baseLoggedSeconds || 0) + elapsed;
      const elapsedInSession = liveSeconds % POMODORO_SECONDS;
      const remainingSeconds = POMODORO_SECONDS - elapsedInSession;

      activeTask = {
        id: sharedState.activeTaskId,
        parentId: found?.parentId || null,
        date: sharedState.date || getLocalTodayString(),
        type: found?.type || 'task',
        title: found?.title || 'Task Aktif',
        isCompleted: found?.isCompleted || false,
        categoryId: found?.categoryId || null,
        estimatedSessions: found?.estimatedSessions || 4,
        completedSessions: Math.floor(liveSeconds / POMODORO_SECONDS),
        loggedSeconds: liveSeconds,
        sortOrder: found?.sortOrder || 1,
        remainingSeconds
      };
    } else if (sharedState.timerMode === 'break' && sharedState.breakStartedAt) {
      const elapsedBreak = Math.max(0, Math.floor((Date.now() - sharedState.breakStartedAt) / 1000));
      breakRemainingSeconds = Math.max(0, (sharedState.breakDurationSeconds || 300) - elapsedBreak);
    }

    return {
      activeTask,
      timerMode: sharedState.timerMode,
      breakRemainingSeconds,
      items: items.filter((i) => i.type === 'task'),
      date: sharedState.date || getLocalTodayString()
    };
  }

  function updateBadge() {
    const status = computeLiveStatus();

    if (status.timerMode === 'work' && status.activeTask) {
      const prevSessions = Math.floor((sharedState.baseLoggedSeconds || 0) / POMODORO_SECONDS);
      const currSessions = Math.floor(status.activeTask.loggedSeconds / POMODORO_SECONDS);

      if (currSessions > prevSessions) {
        const sessionKey = `${status.activeTask.id}:${currSessions}`;
        if (lastNotifiedSessionKey !== sessionKey) {
          lastNotifiedSessionKey = sessionKey;
          const exactSeconds = (prevSessions + 1) * POMODORO_SECONDS;
          const finishedTitle = status.activeTask.title;
          const finishedId = status.activeTask.id;

          sharedState = {
            ...sharedState,
            activeTaskId: null,
            startedAt: null,
            baseLoggedSeconds: exactSeconds,
            lastCompletedTaskId: finishedId,
            timerMode: 'break_prompt',
            updatedAt: Date.now()
          };
          persistToStorage();
          broadcastStateToTabs(true);
          syncToCloudflare(finishedId, exactSeconds);

          chrome.notifications.create({
            type: 'basic',
            iconUrl: '/icon/128.png',
            title: 'Pomodoro 25 Menit Selesai!',
            message: `Sesi fokus untuk "${finishedTitle}" telah rampung. Waktunya istirahat sejenak!`
          });
        }
        setBadge('🎉', '#10b981');
        return;
      }

      const displayMins = Math.ceil(status.activeTask.remainingSeconds / 60);
      setBadge(`${displayMins}m`, '#3b82f6');
      return;
    }

    if (status.timerMode === 'break' && status.breakRemainingSeconds > 0) {
      const displayMins = Math.ceil(status.breakRemainingSeconds / 60);
      setBadge(`${displayMins}m`, '#06b6d4');
      return;
    }

    setBadge('');
  }

  function updateTickerAndBadge() {
    updateBadge();
    const isRunning =
      (sharedState.timerMode === 'work' && sharedState.activeTaskId && sharedState.startedAt) ||
      (sharedState.timerMode === 'break' && sharedState.breakStartedAt);

    if (isRunning && !timerInterval) {
      timerInterval = setInterval(() => {
        updateBadge();
      }, 1000);
    } else if (!isRunning && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  async function requestSyncFromOpenTabs(): Promise<boolean> {
    const tabs = await queryTasklyTabs();
    if (tabs.length > 0 && tabs[0].id) {
      const res = await sendTabMessage(tabs[0].id, { type: 'EXT_REQUEST_SYNC' });
      return Boolean(res);
    }
    return false;
  }

  async function fetchTasksDirectlyIfNeeded() {
    const dateStr = sharedState.date || getLocalTodayString();
    try {
      const res = await fetch(`${apiOrigin}/api/taskly?date=${encodeURIComponent(dateStr)}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.items)) {
          items = data.items;
          persistToStorage();
        }
      }
    } catch {
      // Ignore network/auth error
    }
  }

  async function broadcastStateToTabs(dataUpdated = false) {
    const tabs = await queryTasklyTabs();
    for (const tab of tabs) {
      if (tab.id) {
        await sendTabMessage(tab.id, {
          type: 'EXT_APPLY_TIMER_STATE',
          state: sharedState,
          dataUpdated
        });
      }
    }
  }

  async function syncToCloudflare(id: string, loggedSeconds: number) {
    const completedSessions = Math.floor(loggedSeconds / POMODORO_SECONDS);
    const item = items.find((i) => i.id === id);
    if (item) {
      item.loggedSeconds = loggedSeconds;
      item.completedSessions = completedSessions;
    }
    try {
      await fetch(`${apiOrigin}/api/items/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loggedSeconds,
          completedSessions
        })
      });
    } catch (err) {
      console.error('Gagal sync ke Cloudflare:', err);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 1. Sync masuk dari Content Script di web task.faizhid.my.id
    if (message.type === 'WEB_STATE_SYNC') {
      if (message.origin) apiOrigin = message.origin;
      if (Array.isArray(message.items) && message.items.length >= 0) {
        items = message.items;
      }
      if (message.state) {
        sharedState = message.state;
      }
      persistToStorage();
      updateTickerAndBadge();
      sendResponse({ ok: true });
      return true;
    }

    // 2. Permintaan status dari Popup UI
    if (message.type === 'GET_STATUS') {
      (async () => {
        const syncedFromTab = await requestSyncFromOpenTabs();
        if (!syncedFromTab && items.length === 0) {
          await fetchTasksDirectlyIfNeeded();
        }
        sendResponse(computeLiveStatus());
      })();
      return true;
    }

    // 3. Mulai fokus task dari Popup UI
    if (message.type === 'START_TIMER' && message.task) {
      (async () => {
        const current = computeLiveStatus();
        if (current.activeTask) {
          await syncToCloudflare(current.activeTask.id, current.activeTask.loggedSeconds);
        }

        const targetTask = items.find((i) => i.id === message.task.id) || message.task;
        sharedState = {
          activeTaskId: targetTask.id,
          startedAt: Date.now(),
          baseLoggedSeconds: targetTask.loggedSeconds || 0,
          timerMode: 'work',
          breakDurationSeconds: sharedState.breakDurationSeconds || 300,
          breakStartedAt: null,
          lastCompletedTaskId: targetTask.id,
          date: sharedState.date || getLocalTodayString(),
          updatedAt: Date.now()
        };

        persistToStorage();
        updateTickerAndBadge();
        await broadcastStateToTabs(false);
        sendResponse(computeLiveStatus());
      })();
      return true;
    }

    // 4. Hentikan fokus / istirahat dari Popup UI
    if (message.type === 'STOP_TIMER') {
      (async () => {
        const current = computeLiveStatus();
        if (current.activeTask) {
          await syncToCloudflare(current.activeTask.id, current.activeTask.loggedSeconds);
        }

        sharedState = {
          ...sharedState,
          activeTaskId: null,
          startedAt: null,
          timerMode: 'work',
          breakStartedAt: null,
          updatedAt: Date.now()
        };

        persistToStorage();
        updateTickerAndBadge();
        await broadcastStateToTabs(true);
        sendResponse(computeLiveStatus());
      })();
      return true;
    }

    return true;
  });
});

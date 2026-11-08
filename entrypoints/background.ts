export default defineBackground(() => {
  let timerInterval: any = null
  let activeTask: { id: string; title: string; loggedSeconds: number } | null = null

  // 1. Dengar pesan dari Popup UI (Play / Pause)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_TIMER') {
      activeTask = message.task
      startTimer()
      sendResponse({ status: 'running' })
    }

    if (message.type === 'STOP_TIMER') {
      stopTimer()
      sendResponse({ status: 'stopped' })
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({ activeTask })
    }
    return true
  })

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval)

    timerInterval = setInterval(async () => {
      if (!activeTask) return

      activeTask.loggedSeconds++

      // Format teks badge icon (misal sisa menit: 24m)
      const remainingSec = Math.max(0, 25 * 60 - (activeTask.loggedSeconds % (25 * 60)))
      const displayMins = Math.ceil(remainingSec / 60)

      chrome.action.setBadgeText({ text: `${displayMins}m` })
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }) // Biru

      // Sync ke API task.faizhid.my.id setiap 15 detik
      if (activeTask.loggedSeconds % 15 === 0) {
        syncToCloudflare(activeTask.id, activeTask.loggedSeconds)
      }

      // Notifikasi jika sesi 25 menit selesai
      if (remainingSec === 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icon/128.png',
          title: 'Pomodoro Selesai!',
          message: `Sesi fokus untuk "${activeTask.title}" telah rampung. Istirahat sejenak!`
        })
      }
    }, 1000)
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
    if (activeTask) {
      syncToCloudflare(activeTask.id, activeTask.loggedSeconds)
      activeTask = null
    }
    chrome.action.setBadgeText({ text: '' })
  }

  async function syncToCloudflare(id: string, loggedSeconds: number) {
    try {
      await fetch(`https://task.faizhid.my.id/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loggedSeconds,
          completedSessions: Math.floor(loggedSeconds / 1500)
        })
      })
    } catch (err) {
      console.error('Gagal sync ke Cloudflare:', err)
    }
  }
})
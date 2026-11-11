<template>
  <main class="popup-container">
    <div class="header">
      <div class="brand">
        <span class="brand-dot" :class="{ active: !!currentTask || timerMode === 'break' }"></span>
        <h1>TASKLY MONITOR</h1>
      </div>
      <span class="badge" :class="{ live: !!currentTask || timerMode === 'break' }">
        {{ currentTask ? 'Focusing' : timerMode === 'break' ? 'Break' : 'Live Sync' }}
      </span>
    </div>

    <!-- Sesi Fokus Aktif -->
    <div v-if="currentTask" class="active-card">
      <p class="label">Sedang Dikerjakan (Sisa Sesi 25m):</p>
      <h2 class="task-title" :title="currentTask.title">{{ currentTask.title }}</h2>

      <div class="timer-row">
        <div class="timer-display">
          <span class="timer-main">
            {{ formatMMSS(currentTask.remainingSeconds ?? (1500 - (currentTask.loggedSeconds % 1500))) }}
          </span>
          <span class="timer-sub">
            Total fokus: {{ formatTotal(currentTask.loggedSeconds) }} ({{ currentTask.completedSessions || 0 }}/{{ currentTask.estimatedSessions || 4 }} sesi)
          </span>
        </div>
        <button @click="stopTimer" class="btn-stop">
          Stop Focus
        </button>
      </div>
    </div>

    <!-- Mode Istirahat / Peregangan Aktif -->
    <div v-else-if="timerMode === 'break' && breakRemainingSeconds > 0" class="active-card break-card">
      <p class="label">☕ Mode Istirahat & Peregangan:</p>
      <h2 class="task-title">Rilekskan mata & regangkan badan sejenak</h2>

      <div class="timer-row">
        <div class="timer-display">
          <span class="timer-main" style="color: #22d3ee;">
            {{ formatMMSS(breakRemainingSeconds) }}
          </span>
          <span class="timer-sub">Sisa waktu istirahat</span>
        </div>
        <button @click="stopTimer" class="btn-stop">
          Akhiri Break
        </button>
      </div>
    </div>

    <!-- Belum Ada Sesi Aktif -->
    <div v-else class="empty-state">
      Tidak ada sesi aktif. Pilih task di web atau mulai di bawah.
    </div>

    <!-- Daftar Task Hari Ini untuk Mulai Cepat dari Popup -->
    <div v-if="availableTasks.length > 0" class="task-list-section">
      <p class="section-title">Task Hari Ini ({{ availableTasks.length }})</p>
      <div class="task-list">
        <div v-for="task in availableTasks" :key="task.id" class="task-item">
          <div class="task-item-info">
            <p class="task-item-title" :title="task.title">{{ task.title }}</p>
            <p class="task-item-meta">
              {{ formatTotal(task.loggedSeconds || 0) }} • {{ task.completedSessions || 0 }}/{{ task.estimatedSessions || 4 }} sesi
            </p>
          </div>
          <button @click="startTask(task)" class="btn-start">
            ▶ Mulai
          </button>
        </div>
      </div>
    </div>

    <div class="footer">
      <a href="https://task.faizhid.my.id" target="_blank" class="web-link">
        Buka Taskly Web ↗
      </a>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const currentTask = ref<any>(null)
const timerMode = ref<'work' | 'break_prompt' | 'break'>('work')
const breakRemainingSeconds = ref(0)
const tasks = ref<any[]>([])
let pollInterval: ReturnType<typeof setInterval> | null = null

const availableTasks = computed(() =>
  tasks.value.filter((t) => !t.isCompleted && t.id !== currentTask.value?.id)
)

function formatMMSS(sec: number) {
  const safe = Math.max(0, Math.floor(sec))
  const m = String(Math.floor(safe / 60)).padStart(2, '0')
  const s = String(safe % 60).padStart(2, '0')
  return `${m}:${s}`
}

function formatTotal(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}j ${m}m`
  if (m > 0) return `${m}m ${s}d`
  return `${s}d`
}

function applyResponse(res: any) {
  if (!res) return
  currentTask.value = res.activeTask || null
  timerMode.value = res.timerMode || 'work'
  breakRemainingSeconds.value = res.breakRemainingSeconds || 0
  if (Array.isArray(res.items)) {
    tasks.value = res.items
  }
}

function fetchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (chrome.runtime.lastError) return
    applyResponse(res)
  })
}

function startTask(task: any) {
  chrome.runtime.sendMessage({ type: 'START_TIMER', task }, (res) => {
    if (chrome.runtime.lastError) return
    applyResponse(res)
  })
}

function stopTimer() {
  chrome.runtime.sendMessage({ type: 'STOP_TIMER' }, (res) => {
    if (chrome.runtime.lastError) return
    applyResponse(res)
  })
}

onMounted(() => {
  fetchStatus()
  pollInterval = setInterval(fetchStatus, 1000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})
</script>

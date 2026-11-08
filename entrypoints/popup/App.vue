<template>
  <main class="w-80 p-4 bg-slate-900 text-slate-100 font-sans">
    <div class="flex items-center justify-between pb-3 border-b border-slate-800">
      <h1 class="font-bold text-sm tracking-wide text-blue-400">TASKLY MONITOR</h1>
      <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">Live Sync</span>
    </div>

    <div v-if="currentTask" class="mt-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
      <p class="text-xs text-slate-400">Sedang Dikerjakan:</p>
      <h2 class="font-semibold text-sm truncate mt-0.5 text-white">{{ currentTask.title }}</h2>

      <div class="mt-3 flex items-center justify-between">
        <span class="text-xl font-mono font-bold text-emerald-400">
          {{ formatTimer(currentTask.loggedSeconds) }}
        </span>
        <button @click="toggleTimer"
          class="px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30">
          Stop Focus
        </button>
      </div>
    </div>

    <div v-else class="mt-4 py-6 text-center text-xs text-slate-500">
      Tidak ada sesi aktif. Pilih task di web atau mulai di bawah.
    </div>

    <div class="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
      <a href="https://task.faizhid.my.id" target="_blank"
        class="text-blue-400 hover:underline flex items-center gap-1">
        Buka Taskly Web ↗
      </a>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const currentTask = ref<any>(null)

function formatTimer(sec: number) {
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

onMounted(() => {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res?.activeTask) {
      currentTask.value = res.activeTask
    }
  })
})

function toggleTimer() {
  chrome.runtime.sendMessage({ type: 'STOP_TIMER' }, () => {
    currentTask.value = null
  })
}
</script>
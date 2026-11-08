import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Taskly Focus Tracker',
    version: '1.0.0',
    description: 'Monitor active Pomodoro sessions from task.faizhid.my.id',
    permissions: [
      'storage',
      'alarms',
      'notifications'
    ],
    host_permissions: [
      'https://task.faizhid.my.id/*'
    ]
  }
});

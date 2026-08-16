export const queryKeys = {
  me: ['identity', 'me'] as const,
  navigation: ['overview', 'navigation'] as const,
  dashboard: ['overview', 'dashboard'] as const,
  resource: (path: string) => ['resource', path] as const,
  modules: {
    list: (filters = '') => ['modules', 'list', filters] as const,
    detail: (id: number) => ['modules', 'detail', id] as const,
  },
  classes: {
    list: (filters = '') => ['classes', 'list', filters] as const,
    roster: (id: number, filters = '') => ['classes', 'roster', id, filters] as const,
  },
  gradebook: (schedule: number, period: string) =>
    ['gradebook', schedule, period] as const,
}

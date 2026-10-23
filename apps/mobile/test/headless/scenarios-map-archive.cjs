module.exports = [{ inventory: ['MAP-HISTORY-03'], file: 'src/__tests__/headlessMapArchiveScenario.test.ts',
  pattern: 'actual development archive', platforms: ['ios', 'android'],
  assertions: 'The real development Map settings callback waits for history before deleting both stops, drains durable deletes and stops the active route. A rejected history insert is best effort and still permits the next history record and all deletions. Production absence is separately covered by the actual reset scenario.' }];

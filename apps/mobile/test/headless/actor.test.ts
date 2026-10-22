test('owns one isolated headless device until disposal', async () => {
  await require('./runtime.cjs').run(jest);
});

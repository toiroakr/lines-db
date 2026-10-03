export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (data: unknown) => ({ value: data }),
    types: undefined as unknown as {
      input: { kind: 'a'; a: string } | { kind: 'b'; b: number; note?: string };
      output: unknown;
    },
  },
};

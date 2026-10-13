import * as v from 'valibot';

export const schema = v.object({
  id: v.pipe(v.number(), v.integer()),
  name: v.optional(v.string()),
  nickname: v.nullable(v.string()),
});

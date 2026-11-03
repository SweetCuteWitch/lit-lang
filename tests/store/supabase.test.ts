import { createClient } from '@supabase/supabase-js';
import { describe } from 'vitest';
import { loadConfig } from '../../src/config';
import { createSupabaseStore } from '../../src/store/supabase';
import { storeContract } from './contract';

// Wipes every table: run only against a test project (RUN_SUPABASE_TESTS=1).
describe.skipIf(process.env.RUN_SUPABASE_TESTS !== '1')('supabase store', () => {
  storeContract(async () => {
    const cfg = loadConfig();
    const db = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
    for (const t of ['answers', 'sessions', 'tasks', 'words', 'portions', 'lessons', 'settings']) {
      const col = t === 'lessons' ? 'no' : t === 'settings' ? 'key' : 'id';
      const res = await db.from(t).delete().not(col, 'is', null);
      if (res.error) throw new Error(res.error.message);
    }
    return createSupabaseStore(cfg);
  });
});

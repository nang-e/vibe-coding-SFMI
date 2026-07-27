import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

describe('schema', () => {
  it('can read the seeded themes table', async () => {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.from('themes').select('name');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});

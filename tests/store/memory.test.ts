import { describe } from 'vitest';
import { createMemoryStore } from '../../src/store/memory';
import { storeContract } from './contract';

describe('memory store', () => {
  storeContract(() => createMemoryStore());
});

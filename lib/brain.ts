/**
 * Optimal Engine adapter. The real provider (default) shells out to the installed
 * engine CLI (brain-store markdown + Supabase + ZeroEntropy hybrid search)
 * with a local brain-store fallback when the database is unreachable.
 * BRAIN_PROVIDER=stub selects the inert provider for tests.
 */
import { brainProviderName } from '@/lib/stores';
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { createHindsightStarProvider } from '@/lib/connectors/hindsight-star';

export type BrainStatus = {
  connected: boolean;
  provider: string;
  detail: string;
};

export type BrainSearchResult = {
  title: string;
  snippet: string;
  source: string;
};

export interface BrainProvider {
  name: string;
  status(): Promise<BrainStatus>;
  search(query: string): Promise<BrainSearchResult[]>;
}

const stubProvider: BrainProvider = {
  name: 'stub',
  async status() {
    return {
      connected: false,
      provider: 'stub',
      detail:
        'G Brain is not wired yet. Implement a BrainProvider in lib/brain.ts and set BRAIN_PROVIDER to activate it.',
    };
  },
  async search() {
    return [];
  },
};

export function getBrainProvider(): BrainProvider {
  const name = brainProviderName();
  if (name === 'stub') return stubProvider;
  if (name === 'hindsight-star') return createHindsightStarProvider();
  return createGBrainProvider();
}

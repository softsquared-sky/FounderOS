import type { BrainProvider } from '@/lib/brain';
import { MemoryConnectionError, memoryStatus, searchMemory } from '@/lib/star/memory-server';

/** Opt-in native Optimal Engine search. Retain and Reflect are intentionally absent. */
export function createHindsightStarProvider(): BrainProvider {
  return {
    name: 'hindsight-star',
    async status() {
      try { const s = await memoryStatus(); return { connected: true, provider: 'hindsight-star', detail: `agent-star · ${s.nodes} memories · read-only` }; }
      catch (e) { return { connected: false, provider: 'hindsight-star', detail: e instanceof MemoryConnectionError ? e.code : 'unavailable' }; }
    },
    async search(query) {
      const response = await searchMemory({ query });
      // The compact native interface has no missing-evidence state. Only
      // source-backed matches may enter it; the Star view shows full coverage.
      return response.results.filter(r => r.evidenceComplete).map(r => ({ title: r.context || r.documentId || '스타 기억', snippet: r.text, source: `Hindsight agent-star / ${r.documentId || r.id}` }));
    },
  };
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

describe('/analytics honesty (H21 to H23)', () => {
  const page = read('app/analytics/page.tsx');

  test('no fabricated sparks or bars remain (AC03.13)', () => {
    expect(page).not.toMatch(/sparkFor|barsFor|MiniBars/);
    // sparks come only from real series: the audience line and the run log
    expect(page).toContain('audience.all.points.slice(-SPARK_POINTS)');
    expect(page).toContain('platformSpark.get(p.platform)');
    // a tile without history gets no spark
    expect(page).toMatch(/spark && spark\.length > 1 \? <Spark/);
  });

  test('one audience definition with /social (H22, AC03.15)', () => {
    expect(page).toContain('audienceTotal(db)');
    expect(page).toContain("label: 'Total audience'");
    expect(page).not.toContain('totalFollowers');
    // both pages sync the same way before reading (awaited together, SPEC 4.1 a5)
    // FounderOS keeps its own /agents and /social (founderos/, tests/founderos-screens.test.ts); it reads the same snapshots.
    for (const file of ['app/analytics/page.tsx']) {
      const src = read(file);
      const synced = src.indexOf('await Promise.all([\n    syncFromZernioLive(db),\n    syncBeehiivEmail(db),');
      expect(synced, file).toBeGreaterThan(-1);
      expect(synced, file).toBeLessThan(src.indexOf('buildSocialDashboard(db)'));
    }
    expect(page).not.toContain('syncFromZernioConfig');
  });

  test('run volume explains an empty window instead of a flat zero line (H23)', () => {
    expect(page).toMatch(/windowRuns === 0 \?/);
    expect(page).toContain('No runs in the last 14 days');
    expect(page).toContain('No agent runs recorded yet');
    expect(page).toMatch(/Last run \{fmtShort\(lastRunAt/);
  });
});

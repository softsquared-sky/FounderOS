import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestBrainDump } from '@/lib/brain-dump';
import { createGBrainProvider, type CaptureInput } from '@/lib/connectors/gbrain';
import { brainProviderName } from '@/lib/stores';

export const dynamic = 'force-dynamic';

const DumpSchema = z.object({
  text: z.string().min(1),
  title: z.string().optional(),
  folder: z.string().regex(/^[a-z0-9-]+$/i),
  tags: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  if (brainProviderName() === 'hindsight-star') return NextResponse.json({ error: 'Hindsight Star is read-only. Use the existing Star record workflow.' }, { status: 405 });
  const parsed = DumpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await ingestBrainDump(parsed.data, {
      capture:
        process.env.BRAIN_PROVIDER === 'stub'
          ? undefined
          : (input: CaptureInput) => createGBrainProvider().capture(input),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'write failed' },
      { status: 500 },
    );
  }
}

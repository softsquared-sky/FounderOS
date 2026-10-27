import { NextRequest, NextResponse } from 'next/server';
import { MemoryRead, MemoryQuery } from '@/lib/star/memory-model';
import { MemoryConnectionError, memoryStatus, readMemoryDetail, readMemoryGraph, searchMemory } from '@/lib/star/memory-server';
import { filmingMode } from '@/lib/paths';
export const runtime = 'nodejs';
const messages = { not_configured: '스타 Hindsight API 연결 설정이 필요합니다.', invalid_config: '서버의 Hindsight 주소·인증 파일 설정을 확인해 주세요.', authentication_required: 'Hindsight 인증이 필요합니다. 서버의 읽기 전용 인증 설정을 확인해 주세요.', unavailable: '기억 저장소에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.', invalid_response: '기억 응답 형식을 확인하지 못했습니다.', not_found: '해당 스타 기억 또는 뱅크를 찾지 못했습니다.' };
function failure(e: unknown) { const code = e instanceof MemoryConnectionError ? e.code : 'unavailable'; return NextResponse.json({ code, error: messages[code], ...(e instanceof MemoryConnectionError && e.stage ? { phase: e.stage } : {}) }, { status: code === 'authentication_required' ? 401 : code === 'not_found' ? 404 : 503, headers: { 'Cache-Control': 'no-store' } }); }
function badInput() { return NextResponse.json({ code: 'invalid_input', error: '검색어·유형·표시 범위를 확인해 주세요.' }, { status: 400 }); }
function enabled() { return process.env.FOUNDEROS_PROFILE === 'star' && !filmingMode(); }
export async function GET(req: NextRequest) {
  if (!enabled()) return failure(new MemoryConnectionError('not_configured'));
  const parsed = MemoryRead.safeParse(Object.fromEntries(req.nextUrl.searchParams)); if (!parsed.success) return badInput();
  const input = parsed.data; if (input.mode === 'detail' && !input.id) return badInput();
  try { const result = input.mode === 'status' ? await memoryStatus() : input.mode === 'detail' ? await readMemoryDetail(input.id!) : await readMemoryGraph(input); return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  if (!enabled()) return failure(new MemoryConnectionError('not_configured'));
  let body: unknown;
  try {
    if (Number(req.headers.get('content-length') || 0) > 4096) return badInput();
    const reader = req.body?.getReader(); if (!reader) return badInput(); let size = 0; const pieces: Uint8Array[] = [];
    for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 4096) { await reader.cancel(); return badInput(); } pieces.push(r.value); }
    body = JSON.parse(Buffer.concat(pieces).toString('utf8'));
  } catch { return badInput(); }
  const parsed = MemoryQuery.safeParse(body); if (!parsed.success) return badInput();
  try { return NextResponse.json(await searchMemory(parsed.data), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return failure(e); }
}

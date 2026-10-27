import { NextResponse } from 'next/server';
import { refreshStarSnapshot } from '@/lib/star/refresh';
export const runtime = 'nodejs';
export async function POST() {
  if (process.env.FOUNDEROS_PROFILE !== 'star' || !process.env.STAR_DASHBOARD_DIR) {
    return NextResponse.json({ error: '기존 스타 연결 설정이 필요합니다.' }, { status: 503 });
  }
  try { await refreshStarSnapshot(); return NextResponse.json({ status: 'saved' }); }
  catch { return NextResponse.json({ error: '새 사본을 가져오지 못했습니다. 이전 사본을 유지합니다.' }, { status: 502 }); }
}

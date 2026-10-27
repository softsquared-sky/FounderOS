import { loadStarSnapshot } from '@/lib/star/source';
import { StarWorkspace } from '@/components/star/StarWorkspace';
export const dynamic = 'force-dynamic';
export default function StarPage() { return <StarWorkspace initial={loadStarSnapshot()} />; }

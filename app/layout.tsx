import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { BRAND } from '@/lib/brand';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ConductorPanel } from '@/components/ConductorPanel';
import { getDb } from '@/lib/data';
import { ACTION_COMMANDS, EXTERNAL_COMMANDS, viewCommands, type Command } from '@/lib/palette';
import { APPEARANCE_INIT_SCRIPT, htmlAttributes } from '@/lib/appearance';
import { getAppearance } from '@/lib/appearance-server';
import { getModulesOff } from '@/lib/modules-server';
import { ModuleGate } from '@/components/ModuleGate';
import { AppearanceSync } from '@/components/AppearanceSync';
import { SIDEBAR_INIT_SCRIPT } from '@/lib/sidebar';
import { ToastProvider } from '@/components/ui/Toast';
import { ShellColumn, ShellOnly } from '@/components/ShellGate';
import { NavProgress } from '@/components/NavProgress';
import { Suspense } from 'react';
import { LegacySlab } from '@/components/legacy/LegacySlab';

// Console two-voice type system (2026-08-20, docs/DESIGN-CONSOLE.md): Geist
// leads — every heading, body line, numeral, and nav item — while Geist Mono
// does the quiet system work: ids, timestamps, code surfaces. Tabular figures
// are forced in globals.css so number columns stay aligned.
const fontGeist = localFont({
  src: './fonts/Geist[wght].ttf',
  weight: '100 900',
  variable: '--font-sans',
});
const fontGeistMono = localFont({
  src: './fonts/GeistMono[wght].ttf',
  weight: '100 900',
  variable: '--font-mono',
});
// Bennett Legacy lettering (FounderOS ui merge SPEC §2.5, O6): JetBrains Mono
// for everything, bundled from app/fonts (OFL, app/fonts/OFL-JetBrainsMono.txt),
// so no font request leaves the machine. Only data-ui='legacy' reads it (L0 block).
const fontJetBrainsMono = localFont({
  src: './fonts/JetBrainsMono[wght].woff2',
  weight: '100 800',
  variable: '--l-font-jb',
  display: 'swap',
  // GladOS and Classic never use it, so it is fetched only when a Legacy page asks for it.
  preload: false,
});

export const metadata: Metadata = {
  title: process.env.FOUNDEROS_PROFILE === 'star' ? 'STAR · 하늘의 비서실' : BRAND.title,
  description: 'Personal operating system and AI agent command center',
};

function buildCommands(off: string[]): Command[] {
  const db = getDb();
  const tools: Command[] = db.tools.all().map((t) => ({
    id: `tool-${t.id}`,
    label: t.name,
    keywords: `${t.category} ${t.description}`,
    href: '/integrations',
    hint: 'tool',
  }));
  const agents: Command[] = db.agents.all().map((a) => ({
    id: `agent-${a.id}`,
    label: a.name,
    keywords: `${a.role} ${a.description}`,
    href: '/agents',
    hint: 'agent',
  }));
  // Views come from the nav (lib/nav.ts, SPEC S12 FR-3) so ⌘K cannot drift from the sidebar.
  return [...viewCommands().filter((c) => !c.href || !off.includes(c.href)), ...ACTION_COMMANDS, ...EXTERNAL_COMMANDS, ...agents, ...tools];
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.FOUNDEROS_PROFILE === 'star') {
    return <html lang="ko"><body className={fontGeist.variable}>{children}</body></html>;
  }
  const appearance = getAppearance();
  // The shell renders its GladOS look from the first byte when the cookie says
  // so (S00 §5.5); after hydration each shell piece follows html[data-ui] live.
  const ui = appearance.ui;
  // Settings → Modules: switched-off views leave the sidebar, palette and digit keys (lib/modules.ts).
  const off = getModulesOff();
  return (
    // Style, accent and mode come from the glados-appearance cookie, so the
    // server already renders the right attributes (SPEC S00 FR-2, lib/appearance.ts).
    <html lang="en" className={`${fontGeist.variable} ${fontGeistMono.variable} ${fontJetBrainsMono.variable}`} {...htmlAttributes(appearance)} suppressHydrationWarning>
      <head>
        {/* Before first paint: resolve System mode, ?mode=, the Classic theme from
            storage and the one-time migration, so there is no flash (lib/appearance.ts). */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        {/* Apply the sidebar width and canvas flag before first paint (lib/sidebar.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body>
        {/* Re-applies this browser's theme and mode after a refresh rewrites <html> (components/AppearanceSync.tsx). */}
        <AppearanceSync server={Object.values(htmlAttributes(getAppearance())).join(' ')} />
        {/* One toast stack for the whole app (SPEC X2): any client component calls useToast(). */}
        <ToastProvider>
          {/* Bare routes (/login, lib/bare-routes.ts) render without the shell:
              ShellOnly drops the chrome and ShellColumn the shell margins. */}
          <ShellOnly>
            <Sidebar brand={{ name: BRAND.name, mark: BRAND.mark }} ui={ui} off={off} />
          </ShellOnly>
          {/* os-shell yields to the Wizard dock: the panel sets --conductor-w
              and the whole content column glides left instead of being covered.
              Its left margin is --sidebar-w (app/globals.css, S09 block). */}
          <ShellColumn className="os-shell flex min-h-screen min-w-0 flex-col" style={{ marginRight: 'var(--conductor-w, 0px)' }}>
            <ShellOnly>
              <Topbar ui={ui} />
              {/* Click feedback until the next page commits (perf; components/NavProgress.tsx). */}
              <Suspense fallback={null}>
                <NavProgress />
              </Suspense>
            </ShellOnly>
            <main className="min-w-0 flex-1 px-8 pb-16 pt-7 wide:px-10 ultra:px-12">
              {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
                  full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
              <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
                {/* Bennett Legacy: every page body on one slab, except full-height workspaces (components/legacy/LegacySlab.tsx). */}
                <LegacySlab ui={ui}>
                  <ModuleGate off={off} ui={ui}>
                    {children}
                  </ModuleGate>
                </LegacySlab>
              </div>
            </main>
          </ShellColumn>
          <ShellOnly>
            <CommandPalette commands={buildCommands(off)} ui={ui} off={off} />
            {/* Notion-style agent dock — the Wizard, aware of the current screen */}
            <ConductorPanel ui={ui} />
          </ShellOnly>
        </ToastProvider>
      </body>
    </html>
  );
}

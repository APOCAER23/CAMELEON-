import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  ChevronLeft,
  History,
  Layers,
  LayoutDashboard,
  Moon,
  Plug,
  Settings,
  Sun,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';
import { APP_VERSION } from '@cameleon/shared';
import { cx, StatusDot } from './ui';
import { CameleonLogo } from './CameleonLogo';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';
import { useTerminal } from '../terminal-context';

export type PageId =
  | 'overview'
  | 'providers'
  | 'models'
  | 'agents'
  | 'profiles'
  | 'usage'
  | 'terminal'
  | 'history'
  | 'activity'
  | 'settings';

const main: [PageId, string, LucideIcon][] = [
  ['overview', 'nav.overview', LayoutDashboard],
  ['providers', 'nav.providers', Plug],
  ['models', 'nav.models', Boxes],
  ['agents', 'nav.agents', Bot],
  ['profiles', 'nav.profiles', Layers],
  ['usage', 'nav.usage', BarChart3],
  ['terminal', 'nav.terminal', TerminalSquare],
];

const secondary: [PageId, string, LucideIcon][] = [
  ['history', 'nav.history', History],
  ['activity', 'nav.activity', Activity],
  ['settings', 'nav.settings', Settings],
];

export function Sidebar({
  page,
  onNavigate,
  collapsed,
  onToggle,
  engineRunning,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  collapsed: boolean;
  onToggle: () => void;
  engineRunning: boolean;
}) {
  const [theme, setTheme] = useTheme();
  const { t } = useI18n();
  const { sessions } = useTerminal();
  const activeSessions = sessions.filter((s) => s.running).length;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  const item = ([id, key, Icon]: [PageId, string, LucideIcon]) => {
    const active = page === id;
    const label = t(key);
    return (
      <button
        key={id}
        onClick={() => onNavigate(id)}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'group relative flex h-9 w-full shrink-0 items-center gap-3 rounded-lg px-4 text-left text-[13px] font-medium transition-colors duration-150',
          active
            ? 'bg-elevated text-fg font-semibold shadow-sm'
            : 'text-fg2 hover:bg-elevated/70 hover:text-fg',
        )}
      >
        <Icon
          className={cx(
            'h-4 w-4 shrink-0 transition-colors',
            active ? 'text-primary' : 'text-muted group-hover:text-fg',
          )}
          aria-hidden
        />
        <span
          className={cx(
            'min-w-0 flex-1 truncate whitespace-nowrap transition-opacity duration-200',
            collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
        >
          {label}
        </span>
        {id === 'terminal' && activeSessions > 0 ? (
          <span
            className={cx(
              'shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary transition-opacity duration-200',
              collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            {activeSessions}
          </span>
        ) : (
          active && (
            <span
              className={cx(
                'h-1.5 w-1.5 shrink-0 rounded-full bg-primary transition-opacity duration-200',
                collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
              )}
            />
          )
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label="Main"
      className={cx(
        'relative flex h-full shrink-0 flex-col bg-sidebar select-none transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}
    >
      {/* Floating arrow toggle on sidebar edge */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        className="absolute -right-3 top-4 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-elevated text-fg2 shadow-md transition-all duration-200 hover:scale-105 hover:bg-primary hover:text-on-primary"
      >
        <ChevronLeft className={cx('h-3.5 w-3.5 transition-transform duration-300', collapsed && 'rotate-180')} />
      </button>

      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Brand Header */}
        <div className="flex h-14 shrink-0 items-center px-2.5">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CameleonLogo className="h-6 w-6" />
            </div>
            <span
              className={cx(
                'whitespace-nowrap text-sm font-bold tracking-wider text-fg transition-all duration-200',
                collapsed ? 'pointer-events-none -translate-x-1 opacity-0' : 'translate-x-0 opacity-100',
              )}
            >
              CAMELEON
            </span>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
          {main.map(item)}
          <div className="my-1.5" />
          {secondary.map(item)}
        </div>

        {/* Footer Controls: Quick Theme Toggle & Engine Status */}
        <div className="flex shrink-0 flex-col gap-2 overflow-hidden bg-sidebar p-2.5">
          {/* Quick Theme Switcher Pill */}
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex h-8 w-full items-center gap-3 rounded-lg bg-card/80 px-4 text-xs text-fg2 transition-colors hover:bg-elevated hover:text-fg"
          >
            {theme === 'dark' ? (
              <Moon className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Sun className="h-4 w-4 shrink-0 text-primary" />
            )}
            <span
              className={cx(
                'min-w-0 flex-1 truncate whitespace-nowrap text-left capitalize transition-opacity duration-200',
                collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
              )}
            >
              {theme === 'dark' ? t('nav.theme.dark') : t('nav.theme.light')}
            </span>
            <span
              className={cx(
                'shrink-0 font-mono text-[10px] text-muted transition-opacity duration-200',
                collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
              )}
            >
              {t('nav.theme')}
            </span>
          </button>

          {/* Engine status indicator */}
          <div
            className="flex h-8 w-full items-center gap-3 rounded-lg bg-bg2/60 px-4 text-xs text-fg2"
            title={engineRunning ? t('nav.engine.running') : t('nav.engine.stopped')}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <StatusDot status={engineRunning ? 'running' : 'stopped'} />
            </span>
            <div
              className={cx(
                'min-w-0 flex-1 truncate whitespace-nowrap transition-opacity duration-200',
                collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
              )}
            >
              <span className="font-medium text-fg">
                {engineRunning ? `${t('nav.engine')} ${t('nav.engine.running')}` : t('nav.engine.stopped')}
              </span>
              <span className="ml-1 text-[11px] text-muted">· v{APP_VERSION}</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

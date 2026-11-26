import { Sparkles } from 'lucide-react';
import { EmptyState, Badge } from '../components/ui';

export function ComingSoon({ title, phase, children }: { title: string; phase: number; children: string }) {
  return (
    <div className="max-w-4xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
            <Badge variant="warn">Phase {phase} Roadmap</Badge>
          </div>
        </div>
      </header>
      <EmptyState icon={<Sparkles className="h-5 w-5" />} title={`Scheduled for Release in Phase ${phase}`}>
        {children}
      </EmptyState>
    </div>
  );
}

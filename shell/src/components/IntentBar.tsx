import { useState, type FormEvent, type KeyboardEvent } from 'react';

interface IntentBarProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

const PLACEHOLDER =
  'Describe a clinical tool to forge — e.g. find diabetic patients whose most recent A1c was over 9%';

export default function IntentBar({ onSubmit, disabled }: IntentBarProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setText('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  // Cmd/Ctrl+Enter submits — convenient during a live demo.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const canSubmit = !disabled && text.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-forge-border bg-forge-surface p-1.5 transition-all duration-200 focus-within:border-forge-ember/60 focus-within:shadow-[0_0_24px_-6px_rgba(245,158,11,0.45)]"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={disabled}
        placeholder={PLACEHOLDER}
        maxLength={4000}
        className="w-full resize-none border-0 bg-transparent px-4 py-3 font-sans text-[15px] leading-relaxed text-forge-text outline-none placeholder:text-forge-faint focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="flex items-center gap-1.5 font-mono text-xs text-forge-faint">
          <kbd className="rounded border border-forge-border bg-forge-raised px-1.5 py-0.5 font-mono text-[11px] text-forge-muted">
            ⌘ ↵
          </kbd>
          forge
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-forge-ember px-6 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-forge-void shadow-[0_0_20px_-4px_rgba(245,158,11,0.6)] transition-all duration-200 hover:bg-forge-emberhi hover:shadow-[0_0_28px_-2px_rgba(245,158,11,0.7)] focus-visible:ring-2 focus-visible:ring-forge-ember/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-void active:bg-forge-emberlo disabled:cursor-not-allowed disabled:bg-forge-raised disabled:text-forge-ghost disabled:shadow-none"
        >
          {disabled ? 'Forging…' : 'Forge'}
        </button>
      </div>
    </form>
  );
}

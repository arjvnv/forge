import { useState, type FormEvent, type KeyboardEvent } from 'react';

interface IntentBarProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

const PLACEHOLDER =
  "Describe the tool you need, e.g. 'show me diabetic patients whose most recent A1c was over 9%'";

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
      className="rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-lg transition-all duration-200"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={disabled}
        placeholder={PLACEHOLDER}
        maxLength={4000}
        className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder:text-slate-500 outline-none transition-all duration-200 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-500">⌘/Ctrl + Enter to build</span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white transition-all duration-200 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {disabled ? 'Building…' : 'Build'}
        </button>
      </div>
    </form>
  );
}

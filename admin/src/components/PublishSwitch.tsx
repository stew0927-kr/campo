// Both choices are always visible: the chosen one is green, the other is grey. Press the grey one to switch.
interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Smaller buttons for table rows. */
  compact?: boolean;
}

export function PublishSwitch({ value, onChange, disabled = false, compact = false }: Props) {
  const choice = (label: string, v: boolean) => {
    const chosen = value === v;
    return (
      <button
        type="button"
        className={chosen ? 'seg chosen' : 'seg'}
        aria-pressed={chosen}
        disabled={disabled}
        onClick={() => {
          if (!chosen) onChange(v);
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <span className={compact ? 'segmented compact' : 'segmented'} role="group" aria-label="앱에 공개">
      {choice('숨김', false)}
      {choice('공개 중', true)}
    </span>
  );
}

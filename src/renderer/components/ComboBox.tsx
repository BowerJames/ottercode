import { useId, useState } from "react";

/**
 * A dumb, controlled combobox: a text input that filters its options as
 * you type, with keyboard navigation. Built for pickers whose option
 * lists are long (pi's model list). No data fetching, no state beyond
 * the open/filter/active trio — the value is the parent's.
 */
export function ComboBox({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not editing
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  const currentLabel = options.find((o) => o.id === value)?.label ?? value;
  const shown = query ?? currentLabel;

  const filtered = options.filter((o) => {
    if (query === null || query === "") return true;
    const q = query.toLowerCase();
    return o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q);
  });

  const select = (id: string) => {
    onChange(id);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className="combo">
      <input
        className="combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const option = filtered[activeIndex];
            if (open && option !== undefined) select(option.id);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(null);
          }
        }}
      />
      {open && (
        <div className="combo-list" id={listId} role="listbox">
          {filtered.length === 0 && (
            <div className="combo-empty">no matches</div>
          )}
          {filtered.map((option, index) => (
            <div
              key={option.id}
              className="combo-option"
              role="option"
              aria-selected={option.id === value}
              tabIndex={-1}
              // onMouseDown beats the input's blur so clicks select.
              onMouseDown={(e) => {
                e.preventDefault();
                select(option.id);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              data-active={index === activeIndex}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import styles from "./SegmentedControl.module.css";

interface SegmentedControlProps {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}

export function SegmentedControl(props: SegmentedControlProps) {
  return (
    <div className={styles.container}>
      {props.options.map((option) => (
        <button
          className={`${styles.item} ${props.value === option.value ? styles.active : ""}`}
          key={option.value}
          onClick={() => props.onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

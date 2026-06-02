import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import styles from "./Input.module.css";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${styles.input} ${props.className ?? ""}`.trim()} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${styles.textarea} ${props.className ?? ""}`.trim()} />;
}
